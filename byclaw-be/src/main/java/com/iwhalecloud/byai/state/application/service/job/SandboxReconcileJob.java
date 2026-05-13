package com.iwhalecloud.byai.state.application.service.job;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;

/**
 * Reconciles DB sandbox lifecycle records with the OpenSandbox runtime.
 */
@Component
@ConditionalOnProperty(prefix = "sandbox.reconcile", name = "enabled", havingValue = "true", matchIfMissing = true)
public class SandboxReconcileJob {

    private static final Logger LOGGER = LoggerFactory.getLogger(SandboxReconcileJob.class);

    private final SandboxService sandboxService;

    public SandboxReconcileJob(SandboxService sandboxService) {
        this.sandboxService = sandboxService;
    }

    @Scheduled(fixedDelayString = "${sandbox.reconcile.fixed-delay:60000}")
    public void reconcileSandboxes() {
        try {
            int restartedCount = sandboxService.reconcileSandboxes();
            if (restartedCount > 0) {
                LOGGER.info("沙箱一致性检测完成，本次重新拉起 {} 个沙箱", restartedCount);
            }
        }
        catch (Exception e) {
            LOGGER.error("沙箱一致性检测任务执行异常", e);
        }
    }
}
