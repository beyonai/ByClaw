package com.iwhalecloud.byai.manager.domain.tenant.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.iwhalecloud.byai.gateway.sandbox.service.TenantSandboxService;
import com.iwhalecloud.byai.manager.domain.tenant.policy.TenantExecutionPolicyService;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.common.util.RuntimeEnvironment;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

/** Administrator deletion shares the durable command and operation-slot authority with provisioning. */
@Service
public class TenantManagedDeletionService {
    private static final org.slf4j.Logger LOG = org.slf4j.LoggerFactory.getLogger(TenantManagedDeletionService.class);
    private final String worker = "tenant-delete-" + java.util.UUID.randomUUID();
    private final TenantCommandStore store;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final TenantAdminTenantMapper tenants;
    private final TenantSandboxService sandboxes;
    private final TenantExecutionPolicyService policies;
    private final SequenceService ids;
    private final ObjectMapper json;
    private final StringRedisTemplate redis;

    public TenantManagedDeletionService(TenantCommandStore store, JdbcTemplate jdbc,
        PlatformTransactionManager transactions, TenantAdminTenantMapper tenants, TenantSandboxService sandboxes,
        TenantExecutionPolicyService policies, SequenceService ids, ObjectMapper json,
        StringRedisTemplate redis) {
        this.store = store; this.jdbc = jdbc; this.tx = new TransactionTemplate(transactions);
        this.tenants = tenants; this.sandboxes = sandboxes; this.policies = policies;
        this.ids = ids; this.json = json; this.redis = redis;
    }

    /** Administrative cleanup remains available even when external provisioning is disabled. */
    @Scheduled(fixedDelayString = "${tenant.delete.reconcile-delay-ms:30000}",
        initialDelayString = "${tenant.delete.reconcile-initial-delay-ms:30000}")
    public void scan() {
        if (RuntimeEnvironment.isDevelopment()) return;
        for (long id : store.candidates("DELETE")) {
            var lease = store.claim(id, worker, java.time.Duration.ofMinutes(30));
            if (lease == null) continue;
            try { execute(lease); }
            catch (Exception error) {
                try {
                    failed(lease, error);
                    LOG.warn("Tenant deletion deferred commandId={} enterpriseId={} exceptionType={}",
                        id, lease.enterpriseId(), error.getClass().getName());
                } catch (Exception stale) {
                    LOG.warn("Tenant deletion acknowledgement deferred commandId={} enterpriseId={} exceptionType={}",
                        id, lease.enterpriseId(), stale.getClass().getName());
                }
            }
        }
    }

    /** Called only after the administrator permission and exact tenant name have been checked. */
    public String request(long tenant, String name, long actor) {
        return tx.execute(transaction -> {
            // UPDATE serializes with provisioning/recovery; no SELECT FOR UPDATE or network call under this lock.
            if (jdbc.update("UPDATE byai.tenant_operation_state SET operation_revision=operation_revision+1 WHERE enterprise_id=?", tenant) != 1)
                throw conflict("tenant.delete.operationMissing");
            String source = tenants.selectConfig(tenant, "INTEGRATION_SOURCE_SYSTEM");
            if (source == null || source.isBlank()) throw conflict("tenant.delete.operationMissing");
            String requestId = "admin-delete-" + tenant;
            var existing = store.byRequest(source, requestId);
            if (existing != null) {
                if (!"DELETE".equals(existing.type()) || !Long.toString(tenant).equals(existing.enterpriseId()))
                    throw conflict("tenant.delete.operationMissing");
                if ("SUCCEEDED".equals(existing.status())) return "COMPLETED";
                requireSlot(tenant, Long.parseLong(existing.commandId()));
                if ("MANUAL_REQUIRED".equals(existing.status()) || "FAILED".equals(existing.status())) {
                    jdbc.update("UPDATE byai.tenant_task SET status='PENDING',error_code=NULL,lease_until=NULL,"
                        + "fencing_token=fencing_token+1,revision=revision+1,next_attempt_at=CURRENT_TIMESTAMP WHERE id=?",
                        Long.parseLong(existing.commandId()));
                    state(tenant, "DELETING", null);
                }
                return "ACCEPTED";
            }
            Long previous = jdbc.queryForObject("SELECT active_command_id FROM byai.tenant_operation_state WHERE enterprise_id=?",
                Long.class, tenant);
            if (previous != null) {
                var command = store.find(previous);
                if (command == null || !"PROVISION".equals(command.type()) || "RUNNING".equals(command.status())
                    || "RECONCILING".equals(command.status())) throw conflict("tenant.delete.commandRunning");
                // A live worker may have claimed the command while we waited for the operation slot.
                if (jdbc.update("UPDATE byai.tenant_task SET status='FAILED',error_code='TENANT_DELETION_REQUESTED',"
                    + "fencing_token=fencing_token+1,revision=revision+1,lease_owner=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP "
                    + "WHERE id=? AND revision=? AND status IN ('PENDING','RETRY_WAIT','MANUAL_REQUIRED','FAILED')",
                    previous, command.revision()) != 1) throw conflict("tenant.delete.commandRunning");
            }
            // 删除是技术生命周期关闭：持久 DELETING 状态阻止 Java 写入，不伪造 HACU 的商业规则。
            long id = ids.nextVal();
            String snapshot = json.createObjectNode().put("enterpriseName", name).put("actor", Long.toString(actor)).toString();
            store.insert(id, source, requestId, TenantCommandRequest.digest(snapshot), "DELETE", tenant, actor, snapshot);
            jdbc.update("UPDATE byai.tenant_operation_state SET active_command_id=? "
                + "WHERE enterprise_id=?", id, tenant);
            state(tenant, "DELETING", null);
            return "ACCEPTED";
        });
    }

    public void execute(TenantCommandStore.Lease lease) {
        long tenant = lease.enterpriseId();
        tx.executeWithoutResult(t -> check(lease));
        // Missing provider identifiers cannot prove that a timed-out create left no resource behind.
        Integer unresolved = jdbc.queryForObject("SELECT count(*) FROM byai.ss_sandbox_record WHERE enterprise_id=? "
            + "AND owner_scope='TENANT' AND sandbox_type IN ('tenant-opengauss','tenant-data-node') "
            + "AND status<>'RELEASED' AND (sandbox_id IS NULL OR TRIM(sandbox_id)='')", Integer.class, tenant);
        if (unresolved == null || unresolved > 0) throw conflict("tenant.delete.resourceUncertain");
        redis.delete("TENANT_CONFIG_" + tenant);
        sandboxes.deleteTenantResources(tenant);
        redis.delete("TENANT_CONFIG_" + tenant);
        tx.executeWithoutResult(t -> {
            check(lease);
            tenants.deleteTenantOrganizations(tenant);
            tenants.deleteTenantMemberships(tenant);
            // Retain the source and managed marker so external command reads remain attributable and fail closed.
            jdbc.update("DELETE FROM byai.tenant_config WHERE enterprise_id=? AND params_code NOT IN "
                + "('PROVISION_REQUEST_ID','PROVISION_STATE','COMMERCIAL_MANAGED','INTEGRATION_SOURCE_SYSTEM')", tenant);
            state(tenant, "DELETED", null);
            store.finish(lease, "SUCCEEDED", "DELETED", null);
        });
    }

    public void failed(TenantCommandStore.Lease lease, Exception error) {
        boolean pending = error instanceof ResponseStatusException failure
            && "tenant.volume.cleanup.pending".equals(failure.getReason());
        String code = pending ? "TENANT_CLEANUP_PENDING" : "TENANT_DELETE_FAILED";
        if (error instanceof ResponseStatusException failure
            && "tenant.delete.resourceUncertain".equals(failure.getReason())) code = "TENANT_DELETE_RESOURCE_UNCERTAIN";
        String result = code;
        tx.executeWithoutResult(t -> {
            check(lease);
            store.finish(lease, pending ? "RETRY_WAIT" : "MANUAL_REQUIRED", "DELETE_RESOURCES", result);
            jdbc.update("UPDATE byai.tenant_task SET next_attempt_at=CURRENT_TIMESTAMP + INTERVAL '30' SECOND WHERE id=?", lease.id());
            state(lease.enterpriseId(), pending ? "DELETING" : "DELETE_FAILED", pending ? null : result);
        });
    }

    private void check(TenantCommandStore.Lease lease) {
        store.fence(lease);
        requireSlot(lease.enterpriseId(), lease.id());
    }
    private void requireSlot(long tenant, long command) {
        Integer count = jdbc.queryForObject("SELECT count(*) FROM byai.tenant_operation_state "
            + "WHERE enterprise_id=? AND active_command_id=?", Integer.class, tenant, command);
        if (count == null || count != 1) throw conflict("tenant.delete.operationMissing");
    }
    private void state(long tenant, String status, String error) {
        ObjectNode state = object(tenants.selectConfig(tenant, "PROVISION_STATE"));
        state.put("status", status);
        if (tenants.updateConfig(tenant, "PROVISION_STATE", state.toString()) != 1) throw conflict("tenant.delete.operationMissing");
        tenants.deleteConfig(tenant, "PROVISION_FAILURE_REASON");
        if (error != null) tenants.insertConfig(ids.nextVal(), tenant, "PROVISION_FAILURE_REASON", error);
    }
    private ObjectNode object(String value) {
        try { return (ObjectNode) json.readTree(value); }
        catch (Exception error) { throw conflict("tenant.delete.operationMissing"); }
    }
    private ResponseStatusException conflict(String code) {
        return new ResponseStatusException(HttpStatus.CONFLICT, code);
    }
}
