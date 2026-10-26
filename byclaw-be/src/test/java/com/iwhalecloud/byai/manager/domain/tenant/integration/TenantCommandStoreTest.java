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
            CREATE TABLE byai.internal_command(id bigint primary key,source_system varchar(64),request_id varchar(128),
            request_hash varchar(64),type varchar(32),enterprise_id bigint,owner_user_id bigint,request_snapshot text,
            status varchar(32),stage varchar(64),result text,error_code varchar(64),revision bigint default 0,
            lease_owner varchar(128),lease_until timestamp with time zone,fencing_token bigint default 0,
            attempt int default 0,next_attempt_at timestamp with time zone default current_timestamp,
            created_at timestamp with time zone default current_timestamp,updated_at timestamp with time zone default current_timestamp,
            UNIQUE(source_system,request_id))
            """);
        jdbc.execute("CREATE TABLE byai.tenant_runtime_operation(enterprise_id bigint primary key, active_command_id bigint, generation bigint default 1, state varchar(32), fencing_token bigint default 0, revision bigint default 0)");
        store = new TenantCommandStore(jdbc);
        tx.executeWithoutResult(s -> store.insert(1,"hacu","request-1","hash","PROVISION",2,3,"{}"));
    }
    @Test void claimIsExclusiveAndExpiredWorkerCannotComplete() {
        var first = store.claim(1,"worker-a",Duration.ofMinutes(5));
        assertNotNull(first);
        assertNull(store.claim(1,"worker-b",Duration.ofMinutes(5)));
        jdbc.update("UPDATE byai.internal_command SET lease_until=DATEADD('SECOND',-1,CURRENT_TIMESTAMP) WHERE id=1");
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
        jdbc.update("INSERT INTO byai.tenant_runtime_operation(enterprise_id,active_command_id,state) VALUES (2,1,'ACTIVE')");
        tx.executeWithoutResult(s -> store.finish(lease,"MANUAL_REQUIRED","DB_CREATING","PROVIDER_RESULT_UNKNOWN"));
        assertEquals(1L, jdbc.queryForObject("SELECT active_command_id FROM byai.tenant_runtime_operation WHERE enterprise_id=2",Long.class));
        assertNull(store.claim(1,"another",Duration.ofMinutes(5)));
    }
}
