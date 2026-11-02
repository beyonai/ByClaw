package com.iwhalecloud.byai.manager.domain.tenant.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

/** Persist intent before a provider call. An unacknowledged intent is never blindly replayed. */
public class TenantProvisioningGuard {
    private final TenantCommandStore store;
    private final com.iwhalecloud.byai.manager.domain.tenant.policy.TenantExecutionPolicyService policies;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final ObjectMapper json;
    private final TenantCommandStore.Lease lease;
    public TenantProvisioningGuard(TenantCommandStore store,JdbcTemplate jdbc,TransactionTemplate tx,
                                   ObjectMapper json,TenantCommandStore.Lease lease,
                                   com.iwhalecloud.byai.manager.domain.tenant.policy.TenantExecutionPolicyService policies) {
        this.policies=policies; this.store=store; this.jdbc=jdbc; this.tx=tx; this.json=json; this.lease=lease;
    }
    public long fencingToken() { return lease.fencingToken(); }
    public long leaseDeadlineEpochSeconds() {
        java.sql.Timestamp deadline = jdbc.queryForObject(
            "SELECT lease_until FROM byai.tenant_task WHERE id=? AND fencing_token=?",
            java.sql.Timestamp.class, lease.id(), lease.fencingToken());
        if (deadline == null) throw new TenantCommandException(409, "STALE_COMMAND_LEASE");
        return deadline.toInstant().getEpochSecond();
    }
    public String providerRequestKey(String step) { return "command-" + lease.id() + ":" + step; }

    public void local(Runnable action) {
        tx.executeWithoutResult(status -> { check(); action.run(); });
    }
    private void check() {
        store.fence(lease);
        Integer owned = jdbc.queryForObject("""
            SELECT count(*) FROM byai.tenant_operation_state
            WHERE enterprise_id=? AND active_command_id=?
            """,Integer.class,lease.enterpriseId(),lease.id());
        if (owned == null || owned != 1) throw new TenantCommandException(409,"OPERATION_SLOT_LOST");
        // Serialize local writes with policy updates; generation changes invalidate the original provisioning command.
        if (jdbc.update("UPDATE byai.tenant_operation_state SET policy_revision=policy_revision "
            + "WHERE enterprise_id=? AND runtime_generation IN ('0','1')", lease.enterpriseId()) != 1) {
            throw policyDisabled();
        }
        try { policies.requireProvisioning(lease.enterpriseId()); }
        catch (com.iwhalecloud.byai.manager.domain.tenant.policy.TenantExecutionPolicyService.PolicyDeniedException denied) {
            throw policyDisabled();
        }
    }

    private TenantCommandException policyDisabled() {
        return new TenantCommandException(409, "POLICY_EXECUTION_DISABLED");
    }
    public <T> T external(String step,Class<T> resultType,ExternalCall<T> action) throws Exception {
        var rows=tx.execute(status -> {
            check();
            var existing=jdbc.queryForList("SELECT status,result FROM byai.tenant_task_step WHERE command_id=? AND step_key=?",lease.id(),step);
            if (!existing.isEmpty()) {
                // Only an audited recovery transaction may authorize a new attempt of this original intent.
                int resumed = jdbc.update("UPDATE byai.tenant_task_step SET status='STARTED',revision=revision+1 "
                    + "WHERE command_id=? AND step_key=? AND status='RETRY_READY'", lease.id(), step);
                if (resumed == 1) {
                    jdbc.update("UPDATE byai.tenant_task SET stage=? WHERE id=?", step, lease.id());
                    return java.util.List.<Map<String,Object>>of();
                }
                return existing;
            }
            jdbc.update("""
                INSERT INTO byai.tenant_task_step(command_id,step_key,status,provider_request_key)
                VALUES (?,?,'STARTED',?)
                """,lease.id(),step,providerRequestKey(step));
            jdbc.update("UPDATE byai.tenant_task SET stage=? WHERE id=?",step,lease.id());
            return java.util.List.<Map<String,Object>>of();
        });
        if (rows != null && !rows.isEmpty()) {
            Map<String,Object> row=rows.getFirst();
            Object state=row.containsKey("status") ? row.get("status") : row.get("STATUS");
            if (!"SUCCEEDED".equals(state)) throw new TenantCommandException(409,"PROVIDER_RESULT_UNKNOWN");
            Object result=row.containsKey("result") ? row.get("result") : row.get("RESULT");
            return json.readValue(result.toString(),resultType);
        }
        // No transaction crosses the network. STARTED remains durable if either process or response is lost.
        // Revalidate after committing the external intent, immediately before entering the provider adapter.
        tx.executeWithoutResult(status -> check());
        T result=action.run();
        String encoded=json.writeValueAsString(result);
        local(() -> jdbc.update("UPDATE byai.tenant_task_step SET status='SUCCEEDED',result=?,revision=revision+1 WHERE command_id=? AND step_key=?",encoded,lease.id(),step));
        return result;
    }
    /** Replay only Redis projections whose receiver enforces fencing and the server lease deadline. */
    public boolean projection(String step, ExternalCall<Boolean> action) throws Exception {
        if (!java.util.Set.of("CONFIG_PUBLISH", "READY_PUBLISH").contains(step)) {
            throw new IllegalArgumentException("Only fenced Redis configuration projections may replay");
        }
        local(() -> {
            var existing = jdbc.queryForList("SELECT status FROM byai.tenant_task_step WHERE command_id=? AND step_key=?", lease.id(), step);
            if (existing.isEmpty()) {
                jdbc.update("INSERT INTO byai.tenant_task_step(command_id,step_key,status,provider_request_key) "
                    + "VALUES (?,?,'STARTED',?)", lease.id(), step, providerRequestKey(step));
            } else {
                jdbc.update("UPDATE byai.tenant_task_step SET status='STARTED',result=NULL,revision=revision+1 "
                    + "WHERE command_id=? AND step_key=?", lease.id(), step);
            }
            jdbc.update("UPDATE byai.tenant_task SET stage=? WHERE id=?", step, lease.id());
        });
        // Rebuild the projection every time so recovered workers publish their own fence and deadline.
        tx.executeWithoutResult(status -> check());
        Boolean result = action.run();
        if (!Boolean.TRUE.equals(result)) {
            throw new TenantCommandException(409, "CONFIG_PROJECTION_REJECTED");
        }
        local(() -> jdbc.update("UPDATE byai.tenant_task_step SET status='SUCCEEDED',result='true',revision=revision+1 "
            + "WHERE command_id=? AND step_key=?", lease.id(), step));
        return true;
    }
    @FunctionalInterface public interface ExternalCall<T> { T run() throws Exception; }
}
