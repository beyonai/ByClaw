package com.iwhalecloud.byai.gateway.sandbox.job;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.gateway.sandbox.service.SandboxLifecycleJobReport;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;

/**
 * Periodically renews remotely expiring sandboxes from DB lifecycle state.
 */
@Component
@ConditionalOnProperty(prefix = "sandbox.renew", name = "enabled", havingValue = "true", matchIfMissing = true)
public class SandboxRenewJob {

    private static final Logger LOGGER = LoggerFactory.getLogger(SandboxRenewJob.class);

    private final SandboxService sandboxService;

    public SandboxRenewJob(SandboxService sandboxService) {
        this.sandboxService = sandboxService;
    }

    @Scheduled(fixedDelayString = "${sandbox.renew.fixed-delay:60000}")
    public void renewDueSandboxes() {
        try {
            SandboxLifecycleJobReport report = sandboxService.renewDueSandboxes();
            LOGGER.info("沙箱续约任务执行完成，候选 {} 个，扫描 {} 个，续约 {} 个，跳过 {} 个，失败 {} 个，成功记录：{}，跳过记录：{}，失败记录：{}",
                report.getTotalCandidates(), report.getScannedCount(), report.getAffectedCount(),
                report.getSkippedCount(), report.getFailedCount(), report.getAffectedSandboxes(),
                report.getSkippedSandboxes(), report.getFailedSandboxes());
            SandboxLifecycleJobReport cronPrelaunchReport = sandboxService.prelaunchDueCronSandboxes();
            LOGGER.info("定时任务沙箱预启动任务执行完成，候选 {} 个，扫描 {} 个，启动 {} 个，跳过 {} 个，失败 {} 个，启动用户：{}，跳过用户：{}，失败用户：{}",
                cronPrelaunchReport.getTotalCandidates(), cronPrelaunchReport.getScannedCount(),
                cronPrelaunchReport.getAffectedCount(), cronPrelaunchReport.getSkippedCount(),
                cronPrelaunchReport.getFailedCount(), cronPrelaunchReport.getAffectedSandboxes(),
                cronPrelaunchReport.getSkippedSandboxes(), cronPrelaunchReport.getFailedSandboxes());
        } catch (Exception e) {
            LOGGER.error("沙箱续约任务执行异常", e);
        }
    }
}
