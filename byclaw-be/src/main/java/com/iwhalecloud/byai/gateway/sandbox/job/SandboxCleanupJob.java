package com.iwhalecloud.byai.gateway.sandbox.job;

import com.iwhalecloud.byai.gateway.sandbox.config.SandboxJobSchedulerConfiguration;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxLifecycleJobReport;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 沙箱清理定时任务 定期检查并清理超时未访问的沙箱环境，避免资源浪费
 */
@Component
@ConditionalOnProperty(prefix = "sandbox.cleanup", name = "enabled", havingValue = "true", matchIfMissing = true)
public class SandboxCleanupJob {

    @org.springframework.beans.factory.annotation.Autowired
    private com.iwhalecloud.byai.gateway.sandbox.platform.PlatformBackgroundExecution platformExecution;

    private static final Logger LOGGER = LoggerFactory.getLogger(SandboxCleanupJob.class);

    @Autowired
    private SandboxService sandboxService;

    /**
     * 按 DSH 宿主的活动上报释放工具沙箱。与超时清理不同，这一步在平台远程模式下也由本服务执行：
     * 远程平台不知道这类租约，释放经 remove-record 转发即可。
     */
    @Scheduled(fixedDelayString = "${sandbox.cleanup.fixed-delay:60000}",
        initialDelayString = "${sandbox.cleanup.tool-env-initial-delay:50000}",
        scheduler = SandboxJobSchedulerConfiguration.SANDBOX_JOB_TASK_SCHEDULER)
    public void releaseReportedToolSandboxes() {
        try {
            SandboxLifecycleJobReport report = sandboxService.releaseReportedToolSandboxes();
            if (report.getTotalCandidates() > 0) {
                LOGGER.debug("工具沙箱按上报释放检查完成，候选 {} 个，释放 {} 个，跳过 {} 个，失败 {} 个，释放记录：{}，失败记录：{}",
                    report.getTotalCandidates(), report.getAffectedCount(), report.getSkippedCount(),
                    report.getFailedCount(), report.getAffectedSandboxes(), report.getFailedSandboxes());
            }
        }
        catch (Exception e) {
            LOGGER.error("工具沙箱按上报释放检查执行异常", e);
        }
    }

    /**
     * 定时清理超时沙箱，默认每分钟检测一次。
     */
    @Scheduled(fixedDelayString = "${sandbox.cleanup.fixed-delay:60000}",
        initialDelayString = "${sandbox.cleanup.initial-delay:35000}",
        scheduler = SandboxJobSchedulerConfiguration.SANDBOX_JOB_TASK_SCHEDULER)
    public void cleanupExpiredSandboxes() {
        if (!platformExecution.isLegacyExecutor()) return;
        LOGGER.debug("开始执行沙箱清理任务");
        try {
            SandboxLifecycleJobReport report = sandboxService.cleanupExpiredSandboxes();
            LOGGER.debug("沙箱清理任务执行完成，候选 {} 个，扫描 {} 个，清理 {} 个，失败 {} 个，释放记录：{}，失败记录：{}",
                report.getTotalCandidates(), report.getScannedCount(), report.getAffectedCount(), report.getFailedCount(),
                report.getAffectedSandboxes(), report.getFailedSandboxes());
        }
        catch (Exception e) {
            LOGGER.error("沙箱清理任务执行异常", e);
        }
        try {
            SandboxLifecycleJobReport report = sandboxService.releaseSilentDshSandboxes();
            LOGGER.debug("DSH 静默释放检查完成，候选 {} 个，释放 {} 个，跳过 {} 个，失败 {} 个，释放记录：{}，失败记录：{}",
                report.getTotalCandidates(), report.getAffectedCount(), report.getSkippedCount(),
                report.getFailedCount(), report.getAffectedSandboxes(), report.getFailedSandboxes());
        }
        catch (Exception e) {
            LOGGER.error("DSH 静默释放检查执行异常", e);
        }
    }
}
