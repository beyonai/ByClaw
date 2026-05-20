package com.iwhalecloud.byai.gateway.sandbox.job;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.gateway.sandbox.service.SandboxLifecycleJobReport;
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
            SandboxLifecycleJobReport report = sandboxService.reconcileSandboxes();
            LOGGER.info("沙箱一致性检测完成，候选 {} 个，扫描 {} 个，重拉 {} 个，保持 {} 个，失败 {} 个，重拉记录：{}，保持记录：{}，失败记录：{}",
                report.getTotalCandidates(), report.getScannedCount(), report.getAffectedCount(),
                report.getSkippedCount(), report.getFailedCount(), report.getAffectedSandboxes(),
                report.getSkippedSandboxes(), report.getFailedSandboxes());
        }
        catch (Exception e) {
            LOGGER.error("沙箱一致性检测任务执行异常", e);
        }
    }
}
