package com.iwhalecloud.byai.state.application.service.job;

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

    private static final Logger LOGGER = LoggerFactory.getLogger(SandboxCleanupJob.class);

    @Autowired
    private SandboxService sandboxService;

    /**
     * 定时清理超时沙箱，默认每分钟检测一次。
     */
    @Scheduled(fixedDelayString = "${sandbox.cleanup.fixed-delay:60000}")
    public void cleanupExpiredSandboxes() {
        LOGGER.info("开始执行沙箱清理任务");
        try {
            SandboxLifecycleJobReport report = sandboxService.cleanupExpiredSandboxes();
            LOGGER.info("沙箱清理任务执行完成，候选 {} 个，扫描 {} 个，清理 {} 个，失败 {} 个，释放记录：{}，失败记录：{}",
                report.getTotalCandidates(), report.getScannedCount(), report.getAffectedCount(), report.getFailedCount(),
                report.getAffectedSandboxes(), report.getFailedSandboxes());
        }
        catch (Exception e) {
            LOGGER.error("沙箱清理任务执行异常", e);
        }
    }
}
