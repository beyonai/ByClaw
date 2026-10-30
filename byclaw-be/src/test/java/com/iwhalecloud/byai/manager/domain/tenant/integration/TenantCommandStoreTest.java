package com.iwhalecloud.byai.manager.domain.tenant.integration;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.time.Duration;
import static org.junit.jupiter.api.Assertions.*;

/** Exercises actual conditional SQL: a stale lease must never publish a new result. */
class TenantCommandStoreTest {
    JdbcTemplate jdbc;
    TenantCommandStore store;
    TransactionTemplate tx;
    @BeforeEach void setup() {
        var ds = new DriverManagerDataSource("jdbc:h2:mem:cmd" + System.nanoTime() + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1", "sa", "");
        jdbc = new JdbcTemplate(ds);
        tx = new TransactionTemplate(new DataSourceTransactionManager(ds));
        jdbc.execute("CREATE SCHEMA byai");
        jdbc.execute("""
            CREATE TABLE byai.tenant_task(id bigint primary key,source_system varchar(64),request_id varchar(128),
            request_hash varchar(64),type varchar(32),enterprise_id bigint,owner_user_id bigint,request_snapshot text,
            status varchar(32),stage varchar(64),error_code varchar(64),revision bigint default 0,
            lease_owner varchar(128),lease_until timestamp with time zone,fencing_token bigint default 0,
            attempt int default 0,next_attempt_at timestamp with time zone default current_timestamp,
            created_at timestamp with time zone default current_timestamp,updated_at timestamp with time zone default current_timestamp,
            UNIQUE(source_system,request_id))
            """);
        jdbc.execute("CREATE TABLE byai.tenant_operation_state(enterprise_id bigint PRIMARY KEY,active_command_id bigint,operation_revision bigint NOT NULL DEFAULT 0,policy_revision bigint,runtime_generation varchar(64) NOT NULL DEFAULT '0',applied_rule_revision bigint,applied_runtime_generation varchar(64),rule_applied_at timestamp with time zone)");
        store = new TenantCommandStore(jdbc);
        tx.executeWithoutResult(s -> store.insert(1,"hacu","request-1","hash","PROVISION",2,3,"{}"));
    }
    @Test void claimIsExclusiveAndExpiredWorkerCannotComplete() {
        var first = store.claim(1,"worker-a",Duration.ofMinutes(5));
        assertNotNull(first);
        assertNull(store.claim(1,"worker-b",Duration.ofMinutes(5)));
        jdbc.update("UPDATE byai.tenant_task SET lease_until=DATEADD('SECOND',-1,CURRENT_TIMESTAMP) WHERE id=1");
        var second = store.claim(1,"worker-b",Duration.ofMinutes(5));
        assertNotNull(second);
        assertTrue(second.fencingToken() > first.fencingToken());
        assertThrows(TenantCommandException.class, () -> tx.executeWithoutResult(s -> store.finish(first,"SUCCEEDED","READY",null)));
        tx.executeWithoutResult(s -> store.finish(second,"SUCCEEDED","READY",null));
        assertEquals("SUCCEEDED", store.find(1).status());
    }
    @Test void transactionRollbackDoesNotLeaveAcceptedCommand() {
        assertThrows(IllegalStateException.class, () -> tx.executeWithoutResult(s -> {
            store.insert(5,"hacu","request-5","hash","PROVISION",6,3,"{}");
            throw new IllegalStateException("abort business reservation");
        }));
        assertNull(store.find(5));
        assertEquals("1", store.byRequest("hacu","request-1").commandId());
    }
    @Test void unknownOutcomeKeepsBusinessOperationSlot() {
        var lease = store.claim(1,"worker",Duration.ofMinutes(5));
        jdbc.update("INSERT INTO byai.tenant_operation_state(enterprise_id,active_command_id) VALUES (2,1)");
        tx.executeWithoutResult(s -> store.finish(lease,"MANUAL_REQUIRED","DB_CREATING","PROVIDER_RESULT_UNKNOWN"));
        assertEquals(1L, jdbc.queryForObject("SELECT active_command_id FROM byai.tenant_operation_state WHERE enterprise_id=2",Long.class));
        assertNull(store.claim(1,"another",Duration.ofMinutes(5)));
        assertFalse(store.canRenewTechnicalLease(2));
    }
    /** 只有原任务真正完成并释放占用，才允许续期租户就绪状态。 */
    @Test void technicalLeaseRenewalWaitsForOriginalTaskCompletion() {
        assertFalse(store.canRenewTechnicalLease(2));
        jdbc.update("INSERT INTO byai.tenant_operation_state(enterprise_id,active_command_id) VALUES (2,1)");
        jdbc.update("UPDATE byai.tenant_operation_state SET policy_revision=3,runtime_generation='2' WHERE enterprise_id=2");
        var lease = store.claim(1,"worker",Duration.ofMinutes(5));
        assertFalse(store.canRenewTechnicalLease(2));
        tx.executeWithoutResult(status -> store.finish(lease,"SUCCEEDED","READY",null));
        assertTrue(store.canRenewTechnicalLease(2));
        assertEquals(3L,jdbc.queryForObject("SELECT policy_revision FROM byai.tenant_operation_state WHERE enterprise_id=2",Long.class));
        assertEquals("2",jdbc.queryForObject("SELECT runtime_generation FROM byai.tenant_operation_state WHERE enterprise_id=2",String.class));
        assertNull(jdbc.queryForObject("SELECT active_command_id FROM byai.tenant_operation_state WHERE enterprise_id=2",Long.class));
    }

}
