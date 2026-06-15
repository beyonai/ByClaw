package com.iwhalecloud.byai.gateway.sandbox.job;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.gateway.sandbox.service.cronprewarm.SandboxCronPrewarmReport;
import com.iwhalecloud.byai.gateway.sandbox.service.cronprewarm.SandboxCronPrewarmService;

/**
 * Scans OpenClaw cron state and prewarms sandboxes for jobs due soon.
 */
@Component
@ConditionalOnProperty(prefix = "sandbox.cron-prewarm", name = "enabled", havingValue = "true", matchIfMissing = true)
public class SandboxCronPrewarmJob {

    private static final Logger LOGGER = LoggerFactory.getLogger(SandboxCronPrewarmJob.class);

    private final SandboxCronPrewarmService cronPrewarmService;

    public SandboxCronPrewarmJob(SandboxCronPrewarmService cronPrewarmService) {
        this.cronPrewarmService = cronPrewarmService;
    }

    @Scheduled(fixedDelayString = "${sandbox.cron-prewarm.fixed-delay:60000}")
    public void prewarmDueCronSandboxes() {
        try {
            SandboxCronPrewarmReport report = cronPrewarmService.prewarmDueCronSandboxes();
            LOGGER.info("OpenClaw cron 预热扫描完成，扫描用户 {} 个，缺失 DB {} 个，缺失表 {} 个，缺失列 {} 个，待执行任务 {} 个，候选容器 {} 个，已存在活跃记录跳过 {} 个，拉起 {} 个，失败 {} 个，拉起记录：{}，跳过记录：{}，失败记录：{}",
                report.getScannedUsers(), report.getMissingDbUsers(), report.getMissingTableUsers(),
                report.getMissingColumnUsers(), report.getDueJobs(), report.getCandidateTargets(),
                report.getActiveSkipped(), report.getLaunched(), report.getFailed(), report.getLaunchedTargets(),
                report.getSkippedTargets(), report.getFailedTargets());
        }
        catch (Exception e) {
            LOGGER.error("OpenClaw cron 预热扫描任务执行异常", e);
        }
    }
}
