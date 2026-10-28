package com.iwhalecloud.byai.common.quota;

import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** Real transactions prove a slow concurrent writer cannot pass the same last available seat. */
class SharedQuotaAdmissionTest {
    private final SharedQuotaReader reader = mock(SharedQuotaReader.class);
    private final QuotaSnapshot quota = new QuotaSnapshot(42, "7", 2, 5, 3, 2);
    private JdbcTemplate jdbc;
    private SharedQuotaAdmission admission;
    private TransactionTemplate tx;

    @BeforeEach void setup() {
        var source = new DriverManagerDataSource("jdbc:h2:mem:quota" + System.nanoTime() + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1", "sa", "");
        jdbc = new JdbcTemplate(source);
        jdbc.execute("CREATE SCHEMA byai");
        jdbc.execute("CREATE TABLE byai.quota_write_guard(scope VARCHAR(32),subject_id BIGINT,version BIGINT NOT NULL,PRIMARY KEY(scope,subject_id))");
        jdbc.execute("CREATE TABLE byai.tenant_user_membership(membership_id BIGINT PRIMARY KEY,enterprise_id BIGINT,user_id BIGINT,status VARCHAR(16))");
        jdbc.execute("CREATE TABLE byai.byai_session_member(session_id BIGINT,mem_obj_type VARCHAR(16),mem_obj_id BIGINT)");
        jdbc.update("INSERT INTO byai.tenant_user_membership VALUES(1,42,1,'ACTIVE')");
        when(reader.read(42)).thenReturn(Optional.of(quota));
        admission = new SharedQuotaAdmission(reader, jdbc);
        tx = new TransactionTemplate(new DataSourceTransactionManager(source));
    }

    @Test void missingPackageSkipsDatabaseGuardAndQuotaCount() {
        when(reader.read(42)).thenReturn(Optional.empty());
        tx.executeWithoutResult(status -> {
            var snapshot = admission.beginEnterprise(42L);
            admission.checkMembers(snapshot, 1);
        });
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM byai.quota_write_guard", Integer.class));
    }

    @Test void concurrentAdmissionsSerializeCountAndWriteInTheirTransaction() throws Exception {
        var start = new CountDownLatch(1);
        var ids = new AtomicLong(10);
        try (var workers = Executors.newFixedThreadPool(2)) {
            var attempts = new java.util.ArrayList<java.util.concurrent.Future<Boolean>>();
            for (int i = 0; i < 2; i++) attempts.add(workers.submit(() -> {
                start.await();
                try {
                    tx.executeWithoutResult(status -> {
                        var snapshot = admission.beginEnterprise(42L);
                        admission.checkMembers(snapshot, 1);
                        jdbc.update("INSERT INTO byai.tenant_user_membership VALUES(?,42,?,'ACTIVE')", ids.incrementAndGet(), ids.get());
                    });
                    return true;
                } catch (ResponseStatusException full) { return false; }
            }));
            start.countDown();
            int admitted = 0;
            for (var attempt : attempts) if (attempt.get(10, TimeUnit.SECONDS)) admitted++;
            assertEquals(1, admitted);
            assertEquals(2, jdbc.queryForObject("SELECT COUNT(*) FROM byai.tenant_user_membership", Integer.class));
        }
    }

    @Test void separateGroupCountsIncludeOwnerAndAssistantAndPreserveExistingAtLowerLimit() {
        jdbc.update("INSERT INTO byai.byai_session_member VALUES(9,'USER',1),(9,'USER',2),(9,'USER',3),(9,'AGENT',10)");
        tx.executeWithoutResult(status -> {
            var snapshot = admission.beginGroup(42L, 9L);
            admission.checkGroupMembers(snapshot, 9L, "USER", 0);
            admission.checkGroupMembers(snapshot, 9L, "AGENT", 1);
            assertThrows(ResponseStatusException.class, () -> admission.checkGroupMembers(snapshot, 9L, "USER", 1));
            assertThrows(ResponseStatusException.class, () -> admission.checkGroupMembers(snapshot, 9L, "AGENT", 2));
        });
    }

    @Test void disabledMembersDoNotConsumeSeatsAndOwnersStillDo() {
        jdbc.update("INSERT INTO byai.tenant_user_membership VALUES(2,42,2,'DISABLED')");
        tx.executeWithoutResult(status -> {
            var snapshot = admission.beginEnterprise(42L);
            assertDoesNotThrow(() -> admission.checkMembers(snapshot, 1));
            assertThrows(ResponseStatusException.class, () -> admission.checkMembers(snapshot, 2));
        });
    }

    @Test void rereadsPolicyAfterWaitingForTheDatabaseGuard() {
        when(reader.read(42)).thenReturn(Optional.of(quota), Optional.of(new QuotaSnapshot(42, "8", 1, 5, 3, 2)));
        tx.executeWithoutResult(status -> {
            var latest = admission.beginEnterprise(42L);
            assertEquals("8", latest.orElseThrow().revision());
            assertThrows(ResponseStatusException.class, () -> admission.checkMembers(latest, 1));
        });
    }

    @Test void initialGroupCountsUseIndependentHumanAndAgentCapacities() {
        assertThrows(ResponseStatusException.class, () -> admission.checkInitialGroup(Optional.of(quota), 4, 0));
        assertThrows(ResponseStatusException.class, () -> admission.checkInitialGroup(Optional.of(quota), 1, 3));
        assertDoesNotThrow(() -> admission.checkInitialGroup(Optional.of(quota), 3, 2));
    }

    @Test void guardRequiresTheMutationTransactionAndRollbackReleasesItsWrite() {
        assertThrows(IllegalStateException.class, () -> admission.beginEnterprise(42L));
        tx.executeWithoutResult(status -> { admission.beginEnterprise(42L); status.setRollbackOnly(); });
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM byai.quota_write_guard", Integer.class));
    }
}
