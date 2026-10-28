package com.iwhalecloud.byai.manager.domain.tenant.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class TenantProvisioningGuardTest {
    private JdbcTemplate db;
    private TenantProvisioningGuard guard;

    @BeforeEach
    void setup() {
        var source = new DriverManagerDataSource("jdbc:h2:mem:guard_" + java.util.UUID.randomUUID()
            + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1", "sa", "");
        db = new JdbcTemplate(source);
        db.execute("CREATE SCHEMA byai");
        db.execute("CREATE TABLE byai.internal_command(id bigint PRIMARY KEY,lease_owner varchar(64),"
            + "fencing_token bigint,status varchar(32),lease_until timestamp with time zone,updated_at timestamp with time zone,stage varchar(64))");
        db.execute("CREATE TABLE byai.tenant_runtime_operation(enterprise_id bigint PRIMARY KEY,active_command_id bigint,state varchar(32))");
        db.execute("CREATE TABLE byai.tenant_policy_cursor(enterprise_id bigint PRIMARY KEY,desired_revision bigint,generation varchar(64))");
        db.execute("CREATE TABLE byai.tenant_execution_policy(enterprise_id bigint,revision bigint,payload text,PRIMARY KEY(enterprise_id,revision))");
        db.execute("CREATE TABLE byai.internal_command_step(command_id bigint,step_key varchar(64),status varchar(32),"
            + "provider_request_key varchar(128),result text,revision bigint DEFAULT 0,PRIMARY KEY(command_id,step_key))");
        db.update("INSERT INTO byai.internal_command(id,lease_owner,fencing_token,status,lease_until) VALUES (7,'worker',1,'RUNNING',?)",
            java.sql.Timestamp.from(Instant.now().plusSeconds(120)));
        db.update("INSERT INTO byai.tenant_runtime_operation VALUES (42,7,'ACTIVE')");
        db.update("INSERT INTO byai.tenant_policy_cursor VALUES (42,1,'0')");
        db.update("INSERT INTO byai.tenant_execution_policy VALUES (42,1,?)", "{\"accessMode\":\"PREPARED\"}");
        guard = new TenantProvisioningGuard(new TenantCommandStore(db), db,
            new TransactionTemplate(new DataSourceTransactionManager(source)), new ObjectMapper(),
            new TenantCommandStore.Lease(7, 42, "worker", 1));
    }

    @Test
    void restrictionAfterCompletedStepPreventsNextProviderAndLocalWrite() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        guard.external("DB_CREATE", Boolean.class, () -> { calls.incrementAndGet(); return true; });
        db.update("INSERT INTO byai.tenant_execution_policy VALUES (42,2,?)", "{\"accessMode\":\"SUSPENDED\"}");
        db.update("UPDATE byai.tenant_policy_cursor SET desired_revision=2 WHERE enterprise_id=42");
        assertThatThrownBy(() -> guard.external("NODE_CREATE", Boolean.class,
            () -> { calls.incrementAndGet(); return true; })).isInstanceOf(TenantCommandException.class)
            .hasMessage("POLICY_EXECUTION_DISABLED");
        assertThatThrownBy(() -> guard.local(calls::incrementAndGet)).hasMessage("POLICY_EXECUTION_DISABLED");
        assertThat(calls).hasValue(1);
        assertThat(db.queryForObject("SELECT count(*) FROM byai.internal_command_step WHERE step_key='NODE_CREATE'", Integer.class)).isZero();
    }

    @Test
    void expiryMalformedPolicyAndChangedGenerationFailClosedBeforeProviderIntent() {
        for (String payload : java.util.List.of("{\"accessMode\":\"PREPARED\",\"effectiveUntil\":\"2000-01-01T00:00:00Z\"}",
            "{\"accessMode\":\"READ_ONLY\"}", "{\"accessMode\":\"PREPARED\",\"effectiveUntil\":1}", "{}")) {
            db.update("UPDATE byai.tenant_execution_policy SET payload=?", payload);
            assertThatThrownBy(() -> guard.external("DB_CREATE", Boolean.class, () -> true)).hasMessage("POLICY_EXECUTION_DISABLED");
        }
        db.update("UPDATE byai.tenant_execution_policy SET payload=?", "{\"accessMode\":\"PREPARED\"}");
        db.update("UPDATE byai.tenant_policy_cursor SET generation='2'");
        assertThatThrownBy(() -> guard.external("DB_CREATE", Boolean.class, () -> true)).hasMessage("POLICY_EXECUTION_DISABLED");
        assertThat(db.queryForObject("SELECT count(*) FROM byai.internal_command_step", Integer.class)).isZero();
    }

    @Test
    void startedExternalIntentNeverReplaysProviderAfterRecovery() {
        db.update("INSERT INTO byai.internal_command_step(command_id,step_key,status,provider_request_key) "
            + "VALUES (7,'DB_CREATE','STARTED','command-7:DB_CREATE')");
        AtomicInteger calls = new AtomicInteger();
        assertThatThrownBy(() -> guard.external("DB_CREATE", Boolean.class,
            () -> { calls.incrementAndGet(); return true; })).hasMessage("PROVIDER_RESULT_UNKNOWN");
        assertThat(calls).hasValue(0);
        assertThat(db.queryForObject("SELECT status FROM byai.internal_command_step", String.class)).isEqualTo("STARTED");
    }

    @Test
    void projectionsReplayCompletedAndUnknownIntentsButResourceCallsDoNot() throws Exception {
        AtomicInteger projections = new AtomicInteger();
        guard.projection("CONFIG_PUBLISH", () -> { projections.incrementAndGet(); return true; });
        guard.projection("CONFIG_PUBLISH", () -> { projections.incrementAndGet(); return true; });
        db.update("UPDATE byai.internal_command_step SET status='STARTED' WHERE step_key='CONFIG_PUBLISH'");
        guard.projection("CONFIG_PUBLISH", () -> { projections.incrementAndGet(); return true; });
        assertThat(projections).hasValue(3);
        AtomicInteger resources = new AtomicInteger();
        guard.external("DB_CREATE", Boolean.class, () -> { resources.incrementAndGet(); return true; });
        guard.external("DB_CREATE", Boolean.class, () -> { resources.incrementAndGet(); return true; });
        assertThat(resources).hasValue(1);
        assertThatThrownBy(() -> guard.projection("DB_CREATE", () -> true)).isInstanceOf(IllegalArgumentException.class);
        assertThat(db.queryForObject("SELECT status FROM byai.internal_command_step WHERE step_key='CONFIG_PUBLISH'", String.class))
            .isEqualTo("SUCCEEDED");
    }

    @Test
    void currentGenerationOneAndFutureExpiryPermitPreparedWork() throws Exception {
        db.update("UPDATE byai.tenant_policy_cursor SET generation='1'");
        db.update("UPDATE byai.tenant_execution_policy SET payload=?", "{\"accessMode\":\"PREPARED\",\"effectiveUntil\":\"2999-01-01T00:00:00Z\"}");
        assertThat(guard.external("DB_CREATE", Boolean.class, () -> true)).isTrue();
        assertThat(guard.external("DB_CREATE", Boolean.class, () -> { throw new AssertionError("completed step replay"); })).isTrue();
    }
    @Test
    void auditedRetryReusesOriginalIntentAndCanOnlyCallOnce() throws Exception {
        db.update("INSERT INTO byai.internal_command_step(command_id,step_key,status,provider_request_key) "
            + "VALUES (7,'DB_CREATE','RETRY_READY','command-7:DB_CREATE')");
        AtomicInteger calls=new AtomicInteger();
        guard.external("DB_CREATE",Boolean.class,()->{calls.incrementAndGet();return true;});
        guard.external("DB_CREATE",Boolean.class,()->{calls.incrementAndGet();return true;});
        assertThat(calls).hasValue(1);
        assertThat(db.queryForObject("SELECT provider_request_key FROM byai.internal_command_step",String.class)).isEqualTo("command-7:DB_CREATE");
    }

}
