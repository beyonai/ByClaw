package com.iwhalecloud.byai.manager.domain.tenant.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.util.RuntimeEnvironment;
import com.iwhalecloud.byai.gateway.sandbox.service.TenantSandboxService.TemplatePreparingException;
import com.iwhalecloud.byai.manager.domain.tenant.TenantDbProvisioningService;
import com.iwhalecloud.byai.manager.domain.tenant.policy.TenantExecutionPolicyService;
import java.time.Duration;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Scanning is the recovery mechanism; submitting an in-memory Runnable is never acceptance. */
@Component
@ConditionalOnProperty(name="byclaw.integration.enabled",havingValue="true")
public class TenantCommandWorker {
    private static final Logger LOG=LoggerFactory.getLogger(TenantCommandWorker.class);
    private final String worker=UUID.randomUUID().toString();
    private final TenantCommandStore store;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final ObjectMapper json;
    private final TenantDbProvisioningService provisioner;
    private final TenantExecutionPolicyService policies;
    public TenantCommandWorker(TenantCommandStore store,JdbcTemplate jdbc,PlatformTransactionManager transactions,
        ObjectMapper json,TenantDbProvisioningService provisioner,TenantExecutionPolicyService policies) {
        this.store=store;this.jdbc=jdbc;this.tx=new TransactionTemplate(transactions);this.json=json;
        this.provisioner=provisioner;this.policies=policies;
    }
    @Scheduled(fixedDelayString="${byclaw.integration.command-delay-ms:5000}",initialDelayString="${byclaw.integration.command-initial-delay-ms:10000}")
    public void scan() {
        // Local development may share the database, but must never claim provisioning work from it.
        // Check before scanning so restored commands and expired leases remain for deployment workers.
        if (RuntimeEnvironment.isDevelopment()) {
            return;
        }
        for(long id:store.candidates("PROVISION")) {
            var lease=store.claim(id,worker,Duration.ofMinutes(30));
            if(lease==null) continue;
            var guard = new TenantProvisioningGuard(store,jdbc,tx,json,lease,policies);
            try {
                if(!"PROVISION".equals(store.find(id).type())) throw new TenantCommandException(409,"COMMAND_TYPE_UNSUPPORTED");
                provisioner.provisionDurably(lease.enterpriseId(),guard);
                guard.local(() -> {
                    store.fence(lease);
                    policies.setGeneration(lease.enterpriseId(),"1");
                    policies.acknowledge(lease.enterpriseId(),Long.parseLong(policies.projection(lease.enterpriseId()).desiredRevision()),"1","main-service");
                    store.finish(lease,"SUCCEEDED","READY",null);
                });
            } catch(Exception error) {
                // Only a pre-create template response proves the provider did not create an instance.
                boolean waitingForTemplate = error instanceof TemplatePreparingException;
                boolean waitingForSnapshot = error instanceof com.iwhalecloud.byai.common.quota.SharedQuotaReader.SharedQuotaUnavailableException;
                boolean retry = waitingForTemplate || waitingForSnapshot;
                String status = retry ? "RETRY_WAIT" : "MANUAL_REQUIRED";
                String rawCode = error instanceof TenantCommandException command ? command.getMessage() : null;
                String code;
                if (waitingForTemplate) {
                    code = TemplatePreparingException.CODE;
                } else if (waitingForSnapshot) {
                    code = "SHARED_QUOTA_NOT_READY";
                } else {
                    code = rawCode != null && rawCode.matches("[A-Z][A-Z0-9_]{1,79}") ? rawCode : "PROVIDER_RESULT_UNKNOWN";
                }
                try {
                    String failedStage = tx.execute(transaction -> {
                        String stage = store.find(id).stage();
                        store.finish(lease, status, stage, code);
                        if (waitingForTemplate) {
                            // Keep the intent and provider key. The lease, step and retry time commit together.
                            int updated = jdbc.update("""
                                UPDATE byai.tenant_task_step SET status='RETRY_READY', revision=revision+1
                                WHERE command_id=? AND step_key=? AND step_key IN ('DB_CREATE','NODE_CREATE')
                                  AND status='STARTED' AND provider_request_key=?
                                """, id, stage, guard.providerRequestKey(stage));
                            if (updated != 1) throw new TenantCommandException(409, "TEMPLATE_RETRY_STEP_CHANGED");
                        }
                        if (retry) jdbc.update("UPDATE byai.tenant_task SET next_attempt_at=CURRENT_TIMESTAMP + INTERVAL '5' SECOND WHERE id=?", id);
                        return stage;
                    });
                    // Log only after the durable acknowledgement commits, without attaching provider payloads.
                    if (waitingForTemplate) {
                        LOG.info("Tenant command waiting for sandbox template commandId={} enterpriseId={} stage={}",
                            id, lease.enterpriseId(), safeStage(failedStage));
                    } else {
                        LOG.error("Tenant command failed commandId={} enterpriseId={} status={} stage={} errorCode={} exceptionType={} failurePath={}",
                            id, lease.enterpriseId(), status, safeStage(failedStage), code, error.getClass().getName(), failurePath(error));
                    }
                } catch(Exception stale) {
                    // The next scan will reclaim an expired command; the old worker must not overwrite it.
                    LOG.warn("Tenant command acknowledgement failed commandId={} enterpriseId={} stage=UNKNOWN errorCode={} exceptionType={} acknowledgementExceptionType={} failurePath={}",
                        id,lease.enterpriseId(),code,error.getClass().getName(),stale.getClass().getName(),failurePath(error));
                }
            }
        }
    }

    /**
     * Retain bounded cause types and application locations without provider messages, file paths or credentials.
     * @param failure original provisioning failure
     * @return cause chain suitable for operational logs
     */
    private static String failurePath(Throwable failure) {
        var path = new java.util.StringJoiner(" <- ");
        var visited = java.util.Collections.newSetFromMap(new java.util.IdentityHashMap<Throwable, Boolean>());
        for (Throwable cause = failure; cause != null && visited.size() < 8 && visited.add(cause); cause = cause.getCause()) {
            String location = "";
            for (StackTraceElement frame : cause.getStackTrace()) {
                if (frame.getClassName().startsWith("com.iwhalecloud.byai.")) {
                    location = "@" + frame.getClassName() + "." + frame.getMethodName() + ":" + frame.getLineNumber();
                    break;
                }
            }
            path.add(cause.getClass().getName() + location);
        }
        return path.toString();
    }

    private static String safeStage(String stage) {
        return stage!=null&&stage.matches("[A-Z][A-Z0-9_]{1,79}")?stage:"UNKNOWN";
    }
}
