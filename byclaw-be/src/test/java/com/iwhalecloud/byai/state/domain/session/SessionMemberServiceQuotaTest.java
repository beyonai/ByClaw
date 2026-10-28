package com.iwhalecloud.byai.state.domain.session;

import com.iwhalecloud.byai.common.quota.QuotaSnapshot;
import com.iwhalecloud.byai.common.quota.SharedQuotaAdmission;
import com.iwhalecloud.byai.common.quota.SharedQuotaReader;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMemberMapper;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/** Exercises generic writers against persisted group ownership, counts, and the actual SQL transaction. */
class SessionMemberServiceQuotaTest {
    private final SharedQuotaReader reader = mock(SharedQuotaReader.class);
    private final ByaiSessionMemberMapper mapper = mock(ByaiSessionMemberMapper.class);
    private final SessionMemberService members = new SessionMemberService();
    private JdbcTemplate jdbc;
    private TransactionTemplate tx;

    @BeforeEach void setup() {
        var source = new DriverManagerDataSource("jdbc:h2:mem:genericquota" + System.nanoTime() + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1", "sa", "");
        jdbc = new JdbcTemplate(source);
        jdbc.execute("CREATE SCHEMA byai");
        jdbc.execute("CREATE TABLE byai.quota_write_guard(scope VARCHAR(32),subject_id BIGINT,version BIGINT NOT NULL,PRIMARY KEY(scope,subject_id))");
        jdbc.execute("CREATE TABLE byai.byai_session(session_id BIGINT PRIMARY KEY,enterprise_id BIGINT,session_type VARCHAR(16))");
        jdbc.execute("CREATE TABLE byai.byai_session_ext(session_id BIGINT,ext_param_code VARCHAR(64),ext_param_value VARCHAR(64))");
        jdbc.execute("CREATE TABLE byai.byai_session_member(byai_session_member_id BIGINT PRIMARY KEY,session_id BIGINT,mem_obj_type VARCHAR(16),mem_obj_id BIGINT)");
        jdbc.update("INSERT INTO byai.byai_session VALUES(9,42,'hs_as'),(10,42,'h_as'),(11,42,'hs_as'),(12,42,'hs_as')");
        jdbc.update("INSERT INTO byai.byai_session_ext VALUES(9,?,'42'),(12,?,'NONE')", SharedQuotaAdmission.BUSINESS_ENTERPRISE_EXT, SharedQuotaAdmission.BUSINESS_ENTERPRISE_EXT);
        jdbc.update("INSERT INTO byai.byai_session_member VALUES(1,9,'USER',1),(2,9,'AGENT',100)");
        when(reader.read(42L)).thenReturn(Optional.of(new QuotaSnapshot(42L, "1", 10, 5, 1, 1)));
        when(mapper.insert(any(ByaiSessionMember.class))).thenAnswer(call -> {
            ByaiSessionMember row = call.getArgument(0);
            return jdbc.update("INSERT INTO byai.byai_session_member VALUES(?,?,?,?)", row.getByaiSessionMemberId(), row.getSessionId(), row.getMemObjType(), row.getMemObjId());
        });
        ReflectionTestUtils.setField(members, "byaiSessionMemberMapper", mapper);
        ReflectionTestUtils.setField(members, "quotaAdmission", new SharedQuotaAdmission(reader, jdbc));
        tx = new TransactionTemplate(new DataSourceTransactionManager(source));
    }

    @Test void genericAgentAndHumanSaveCannotBypassSeparateGroupCaps() {
        for (String type : java.util.List.of("USER", "AGENT")) {
            assertThrows(ResponseStatusException.class, () -> tx.executeWithoutResult(status -> members.save(row(3, 9, type, 200))));
        }
        assertEquals(2, jdbc.queryForObject("SELECT COUNT(*) FROM byai.byai_session_member WHERE session_id=9", Integer.class));
        verify(mapper, never()).insert(any(ByaiSessionMember.class));
    }

    @Test void hAsPrivateSessionAndMarkedPersonalGroupNeverReadCommercialQuota() {
        tx.executeWithoutResult(status -> {
            assertEquals(1, members.save(row(3, 10, "AGENT", 200)));
            assertEquals(1, members.save(row(4, 12, "AGENT", 201)));
        });
        verifyNoInteractions(reader);
    }

    @Test void repeatedExistingGroupMemberDoesNotConsumeOrDuplicateASeat() {
        tx.executeWithoutResult(status -> assertEquals(0, members.save(row(3, 9, "AGENT", 100))));
        verify(mapper, never()).insert(any(ByaiSessionMember.class));
        assertEquals(2, jdbc.queryForObject("SELECT COUNT(*) FROM byai.byai_session_member WHERE session_id=9", Integer.class));
    }

    @Test void unmarkedPublishedGroupCannotGuessOwnershipAndMissingPackageAllowsIt() {
        assertThrows(ResponseStatusException.class, () -> tx.executeWithoutResult(status -> members.save(row(3, 11, "AGENT", 200))));
        when(reader.read(42L)).thenReturn(Optional.empty());
        tx.executeWithoutResult(status -> assertEquals(1, members.save(row(3, 11, "AGENT", 200))));
    }

    @Test void concurrentGenericGroupWritersCannotShareTheLastAgentSeat() throws Exception {
        when(reader.read(42L)).thenReturn(Optional.of(new QuotaSnapshot(42L, "2", 10, 5, 1, 2)));
        var start = new java.util.concurrent.CountDownLatch(1);
        try (var workers = java.util.concurrent.Executors.newFixedThreadPool(2)) {
            var attempts = new java.util.ArrayList<java.util.concurrent.Future<Boolean>>();
            for (long id : java.util.List.of(3L, 4L)) attempts.add(workers.submit(() -> {
                start.await();
                try {
                    tx.executeWithoutResult(status -> members.save(row(id, 9, "AGENT", 200 + id)));
                    return true;
                } catch (ResponseStatusException full) { return false; }
            }));
            start.countDown();
            int inserted = 0;
            for (var attempt : attempts) if (attempt.get(10, java.util.concurrent.TimeUnit.SECONDS)) inserted++;
            assertEquals(1, inserted);
            assertEquals(2, jdbc.queryForObject("SELECT COUNT(*) FROM byai.byai_session_member WHERE session_id=9 AND mem_obj_type='AGENT'", Integer.class));
        }
    }

    private ByaiSessionMember row(long id, long session, String type, long memberId) {
        var row = new ByaiSessionMember(); row.setByaiSessionMemberId(id); row.setSessionId(session);
        row.setMemObjType(type); row.setMemObjId(memberId); return row;
    }
}
