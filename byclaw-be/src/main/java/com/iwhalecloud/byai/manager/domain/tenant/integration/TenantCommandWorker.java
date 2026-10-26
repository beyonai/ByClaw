package com.iwhalecloud.byai.manager.domain.tenant.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.hook.HookPublisher;
import com.iwhalecloud.byai.manager.domain.tenant.TenantDbProvisioningService;
import com.iwhalecloud.byai.manager.domain.tenant.policy.TenantExecutionPolicyService;
import java.time.Duration;
import java.util.Map;
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
    private final HookPublisher hooks;
    public TenantCommandWorker(TenantCommandStore store,JdbcTemplate jdbc,PlatformTransactionManager transactions,
        ObjectMapper json,TenantDbProvisioningService provisioner,TenantExecutionPolicyService policies,HookPublisher hooks) {
        this.store=store;this.jdbc=jdbc;this.tx=new TransactionTemplate(transactions);this.json=json;
        this.provisioner=provisioner;this.policies=policies;this.hooks=hooks;
    }
    @Scheduled(fixedDelayString="${byclaw.integration.command-delay-ms:5000}",initialDelayString="${byclaw.integration.command-initial-delay-ms:10000}")
    public void scan() {
        for(long id:store.candidates()) {
            var lease=store.claim(id,worker,Duration.ofMinutes(30));
            if(lease==null) continue;
            try {
                if(!"PROVISION".equals(store.find(id).type())) throw new TenantCommandException(409,"COMMAND_TYPE_UNSUPPORTED");
                var guard = new TenantProvisioningGuard(store,jdbc,tx,json,lease);
                provisioner.provisionDurably(lease.enterpriseId(),guard);
                guard.local(() -> {
                    store.fence(lease);
                    policies.setGeneration(lease.enterpriseId(),"1");
                    policies.acknowledge(lease.enterpriseId(),Long.parseLong(policies.projection(lease.enterpriseId()).desiredRevision()),"1","main-service");
                    store.finish(lease,"SUCCEEDED","READY",null);
                    hooks.publishDurable("tenant.provisioning.completed",1,Long.toString(lease.enterpriseId()),
                        Long.toString(store.find(id).revision()),"1",Long.toString(id),
                        Map.of("enterpriseId",Long.toString(lease.enterpriseId()),"commandId",Long.toString(id),"stage","READY"));
                });
            } catch(Exception error) {
                // Existing provider adapters cannot prove non-creation after a transport failure. Keep the slot.
                try {
                    tx.executeWithoutResult(status -> {
                        String stage=store.find(id).stage();
                        String code=error instanceof TenantCommandException command ? command.getMessage() : "PROVIDER_RESULT_UNKNOWN";
                        store.finish(lease,"MANUAL_REQUIRED",stage,code);
                        hooks.publishDurable("tenant.provisioning.failed",1,Long.toString(lease.enterpriseId()),
                            Long.toString(store.find(id).revision()),"1",Long.toString(id),
                            Map.of("enterpriseId",Long.toString(lease.enterpriseId()),"commandId",Long.toString(id),
                                "stage",stage,"errorCode",code));
                    });
                } catch(Exception stale) {
                    // The next scan will reclaim an expired command; the old worker must not overwrite it.
                    LOG.warn("Tenant command {} could not acknowledge completion ({})",id,stale.getClass().getSimpleName());
                }
            }
        }
    }
}
