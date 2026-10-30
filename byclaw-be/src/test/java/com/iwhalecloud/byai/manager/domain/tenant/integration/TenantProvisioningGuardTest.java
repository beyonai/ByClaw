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
    private final com.iwhalecloud.byai.common.quota.TestSharedPolicies shared = new com.iwhalecloud.byai.common.quota.TestSharedPolicies();
    private TenantProvisioningGuard guard;

    @BeforeEach
    void setup() throws Exception {
        var source = new DriverManagerDataSource("jdbc:h2:mem:guard_" + java.util.UUID.randomUUID()
            + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1", "sa", "");
        db = new JdbcTemplate(source);
        db.execute("CREATE SCHEMA byai");
        db.execute("CREATE TABLE byai.tenant_config(enterprise_id bigint,params_code varchar(64),params_value text)");
        db.execute("CREATE TABLE byai.tenant_task(id bigint PRIMARY KEY,lease_owner varchar(64),"
            + "fencing_token bigint,status varchar(32),lease_until timestamp with time zone,updated_at timestamp with time zone,stage varchar(64))");
        db.execute("CREATE TABLE byai.tenant_operation_state(enterprise_id bigint PRIMARY KEY,active_command_id bigint,operation_revision bigint NOT NULL DEFAULT 0,policy_revision bigint,runtime_generation varchar(64) NOT NULL DEFAULT '0',applied_rule_revision bigint,applied_runtime_generation varchar(64),rule_applied_at timestamp with time zone)");
        db.execute("CREATE TABLE byai.tenant_task_step(command_id bigint,step_key varchar(64),status varchar(32),"
            + "provider_request_key varchar(128),result text,revision bigint DEFAULT 0,PRIMARY KEY(command_id,step_key))");
        db.update("INSERT INTO byai.tenant_task(id,lease_owner,fencing_token,status,lease_until) VALUES (7,'worker',1,'RUNNING',?)",
            java.sql.Timestamp.from(Instant.now().plusSeconds(120)));
        db.update("INSERT INTO byai.tenant_operation_state(enterprise_id,active_command_id,operation_revision,policy_revision,runtime_generation) VALUES (42,7,0,1,'0')");
        shared.publish(42,new ObjectMapper().readTree("{\"accessMode\":\"PREPARED\"}"));
        guard = new TenantProvisioningGuard(new TenantCommandStore(db), db,
            new TransactionTemplate(new DataSourceTransactionManager(source)), new ObjectMapper(),
            new TenantCommandStore.Lease(7, 42, "worker", 1),
            new com.iwhalecloud.byai.manager.domain.tenant.policy.TenantExecutionPolicyService(db,new ObjectMapper(),shared.reader,false,""));
    }

    @Test
    void restrictionAfterCompletedStepPreventsNextProviderAndLocalWrite() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        guard.external("DB_CREATE", Boolean.class, () -> { calls.incrementAndGet(); return true; });
        shared.publish(42,new ObjectMapper().readTree("{\"accessMode\":\"SUSPENDED\"}"));
        db.update("UPDATE byai.tenant_operation_state SET policy_revision=2 WHERE enterprise_id=42");
        assertThatThrownBy(() -> guard.external("NODE_CREATE", Boolean.class,
            () -> { calls.incrementAndGet(); return true; })).isInstanceOf(TenantCommandException.class)
            .hasMessage("POLICY_EXECUTION_DISABLED");
        assertThatThrownBy(() -> guard.local(calls::incrementAndGet)).hasMessage("POLICY_EXECUTION_DISABLED");
        assertThat(calls).hasValue(1);
        assertThat(db.queryForObject("SELECT count(*) FROM byai.tenant_task_step WHERE step_key='NODE_CREATE'", Integer.class)).isZero();
    }

    @Test
    void expiryMalformedPolicyAndChangedGenerationFailClosedBeforeProviderIntent() throws Exception {
        for (String payload : java.util.List.of("{\"accessMode\":\"PREPARED\",\"effectiveUntil\":\"2000-01-01T00:00:00Z\"}",
            "{\"accessMode\":\"READ_ONLY\"}", "{\"accessMode\":\"PREPARED\",\"effectiveUntil\":1}", "{}")) {
            shared.publish(42,new ObjectMapper().readTree(payload));
            assertThatThrownBy(() -> guard.external("DB_CREATE", Boolean.class, () -> true)).isInstanceOf(RuntimeException.class);
        }
        shared.publish(42,new ObjectMapper().readTree("{\"accessMode\":\"PREPARED\"}"));
        db.update("UPDATE byai.tenant_operation_state SET runtime_generation='2'");
        assertThatThrownBy(() -> guard.external("DB_CREATE", Boolean.class, () -> true)).isInstanceOf(RuntimeException.class);
        assertThat(db.queryForObject("SELECT count(*) FROM byai.tenant_task_step", Integer.class)).isZero();
    }

    @Test
    void startedExternalIntentNeverReplaysProviderAfterRecovery() {
        db.update("INSERT INTO byai.tenant_task_step(command_id,step_key,status,provider_request_key) "
            + "VALUES (7,'DB_CREATE','STARTED','command-7:DB_CREATE')");
        AtomicInteger calls = new AtomicInteger();
        assertThatThrownBy(() -> guard.external("DB_CREATE", Boolean.class,
            () -> { calls.incrementAndGet(); return true; })).hasMessage("PROVIDER_RESULT_UNKNOWN");
        assertThat(calls).hasValue(0);
        assertThat(db.queryForObject("SELECT status FROM byai.tenant_task_step", String.class)).isEqualTo("STARTED");
    }

    @Test
    void projectionsReplayCompletedAndUnknownIntentsButResourceCallsDoNot() throws Exception {
        AtomicInteger projections = new AtomicInteger();
        guard.projection("CONFIG_PUBLISH", () -> { projections.incrementAndGet(); return true; });
        guard.projection("CONFIG_PUBLISH", () -> { projections.incrementAndGet(); return true; });
        db.update("UPDATE byai.tenant_task_step SET status='STARTED' WHERE step_key='CONFIG_PUBLISH'");
        guard.projection("CONFIG_PUBLISH", () -> { projections.incrementAndGet(); return true; });
        assertThat(projections).hasValue(3);
        AtomicInteger resources = new AtomicInteger();
        guard.external("DB_CREATE", Boolean.class, () -> { resources.incrementAndGet(); return true; });
        guard.external("DB_CREATE", Boolean.class, () -> { resources.incrementAndGet(); return true; });
        assertThat(resources).hasValue(1);
        assertThatThrownBy(() -> guard.projection("DB_CREATE", () -> true)).isInstanceOf(IllegalArgumentException.class);
        assertThat(db.queryForObject("SELECT status FROM byai.tenant_task_step WHERE step_key='CONFIG_PUBLISH'", String.class))
            .isEqualTo("SUCCEEDED");
    }

    @Test
    void currentGenerationOneAndFutureExpiryPermitPreparedWork() throws Exception {
        db.update("UPDATE byai.tenant_operation_state SET runtime_generation='1'");
        shared.publish(42,new ObjectMapper().readTree("{\"accessMode\":\"PREPARED\",\"effectiveUntil\":\"2999-01-01T00:00:00Z\"}"));
        assertThat(guard.external("DB_CREATE", Boolean.class, () -> true)).isTrue();
        assertThat(guard.external("DB_CREATE", Boolean.class, () -> { throw new AssertionError("completed step replay"); })).isTrue();
    }
    @Test
    void auditedRetryReusesOriginalIntentAndCanOnlyCallOnce() throws Exception {
        db.update("INSERT INTO byai.tenant_task_step(command_id,step_key,status,provider_request_key) "
            + "VALUES (7,'DB_CREATE','RETRY_READY','command-7:DB_CREATE')");
        AtomicInteger calls=new AtomicInteger();
        guard.external("DB_CREATE",Boolean.class,()->{calls.incrementAndGet();return true;});
        guard.external("DB_CREATE",Boolean.class,()->{calls.incrementAndGet();return true;});
        assertThat(calls).hasValue(1);
        assertThat(db.queryForObject("SELECT provider_request_key FROM byai.tenant_task_step",String.class)).isEqualTo("command-7:DB_CREATE");
    }

}
