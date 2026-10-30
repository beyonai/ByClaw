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
        jdbc.execute("CREATE TABLE byai.tenant_user_membership(membership_id BIGINT PRIMARY KEY,enterprise_id BIGINT,user_id BIGINT,status VARCHAR(16))");
        jdbc.execute("CREATE TABLE byai.byai_session_member(session_id BIGINT,mem_obj_type VARCHAR(16),mem_obj_id BIGINT)");
        jdbc.execute("CREATE TABLE byai.byai_session(session_id BIGINT PRIMARY KEY,enterprise_id BIGINT,session_type VARCHAR(16),state VARCHAR(32))");
        jdbc.update("INSERT INTO byai.tenant_user_membership VALUES(1,42,1,'ACTIVE')");
        when(reader.read(42)).thenReturn(Optional.of(quota));
        admission = new com.iwhalecloud.byai.common.quota.SharedQuotaAdmission(reader, jdbc, com.iwhalecloud.byai.common.quota.TestQuotaLocks.create());
        tx = new TransactionTemplate(new DataSourceTransactionManager(source));
    }

    @Test void missingPackageSkipsLockAndQuotaCount() {
        when(reader.read(42)).thenReturn(Optional.empty());
        tx.executeWithoutResult(status -> {
            var snapshot = admission.beginEnterprise(42L);
            admission.checkMembers(snapshot, 1);
        });
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

    @Test void rereadsPolicyAfterAcquiringRedisLock() {
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

    @Test void workgroupLimitCountsOnlyEffectiveEnterpriseGroups() {
        jdbc.update("INSERT INTO byai.byai_session VALUES(10,42,'hs_as',NULL),(11,42,'hs_as','CLOSED'),(12,42,'h_as',NULL)");
        tx.executeWithoutResult(status -> {
            var snapshot = admission.beginWorkgroup(42L);
            assertDoesNotThrow(() -> admission.checkWorkgroupCapacity(snapshot, 42L, 1));
            var limited = Optional.of(new QuotaSnapshot(42, "7", 2, 2, 3, 2));
            assertThrows(ResponseStatusException.class, () -> admission.checkWorkgroupCapacity(limited, 42L, 2));
        });
    }

    @Test void closedAndDissolvedGroupsReleaseWorkgroupCapacity() {
        jdbc.update("INSERT INTO byai.byai_session VALUES(20,42,'hs_as','CLOSED'),(21,42,'hs_as','GROUP_DISSOLVED')");
        tx.executeWithoutResult(status -> {
            var limited = Optional.of(new QuotaSnapshot(42, "7", 2, 1, 3, 2));
            assertDoesNotThrow(() -> admission.checkWorkgroupCapacity(limited, 42L, 1));
        });
    }

    @Test void guardRequiresTransactionAndRollbackReleasesLock() {
        assertThrows(IllegalStateException.class, () -> admission.beginEnterprise(42L));
        tx.executeWithoutResult(status -> { admission.beginEnterprise(42L); status.setRollbackOnly(); });
        tx.executeWithoutResult(status -> admission.beginEnterprise(42L));
    }
}
