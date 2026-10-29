package com.iwhalecloud.byai.manager.domain.tenant.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.util.RuntimeEnvironment;
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
            try {
                if(!"PROVISION".equals(store.find(id).type())) throw new TenantCommandException(409,"COMMAND_TYPE_UNSUPPORTED");
                var guard = new TenantProvisioningGuard(store,jdbc,tx,json,lease,policies);
                provisioner.provisionDurably(lease.enterpriseId(),guard);
                guard.local(() -> {
                    store.fence(lease);
                    policies.setGeneration(lease.enterpriseId(),"1");
                    policies.acknowledge(lease.enterpriseId(),Long.parseLong(policies.projection(lease.enterpriseId()).desiredRevision()),"1","main-service");
                    store.finish(lease,"SUCCEEDED","READY",null);
                });
            } catch(Exception error) {
                // Existing provider adapters cannot prove non-creation after a transport failure. Keep the slot.
                String rawCode=error instanceof TenantCommandException command ? command.getMessage() : null;
                boolean waitingForSnapshot = error instanceof com.iwhalecloud.byai.common.quota.SharedQuotaReader.SharedQuotaUnavailableException;
                String code=waitingForSnapshot ? "SHARED_QUOTA_NOT_READY" : rawCode!=null&&rawCode.matches("[A-Z][A-Z0-9_]{1,79}")?rawCode:"PROVIDER_RESULT_UNKNOWN";
                try {
                    String failedStage=tx.execute(status -> {
                        String stage=store.find(id).stage();
                        store.finish(lease,waitingForSnapshot ? "RETRY_WAIT" : "MANUAL_REQUIRED",stage,code);
                        if (waitingForSnapshot) jdbc.update("UPDATE byai.tenant_task SET next_attempt_at=CURRENT_TIMESTAMP + INTERVAL '5' SECOND WHERE id=?",id);
                        return stage;
                    });
                    // Log only after the durable acknowledgement commits, and never attach provider exception payloads.
                    LOG.error("Tenant command failed commandId={} enterpriseId={} status={} stage={} errorCode={} exceptionType={} failurePath={}",
                        id,lease.enterpriseId(),waitingForSnapshot ? "RETRY_WAIT" : "MANUAL_REQUIRED",safeStage(failedStage),code,error.getClass().getName(),failurePath(error));
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
