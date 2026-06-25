package com.iwhalecloud.byai.gateway.sandbox.job;

import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.gateway.sandbox.config.SandboxJobSchedulerConfiguration;
import com.iwhalecloud.byai.gateway.sandbox.service.cronprewarm.SandboxCronPrewarmProperties;
import com.iwhalecloud.byai.gateway.sandbox.service.cronprewarm.SandboxCronPrewarmReport;
import com.iwhalecloud.byai.gateway.sandbox.service.cronprewarm.SandboxCronPrewarmService;

/**
 * Scans OpenClaw cron state and prewarms sandboxes for jobs due soon.
 */
@Component
@ConditionalOnProperty(prefix = "sandbox.cron-prewarm", name = "enabled", havingValue = "true", matchIfMissing = true)
public class SandboxCronPrewarmJob {

    private static final Logger LOGGER = LoggerFactory.getLogger(SandboxCronPrewarmJob.class);

    private static final String SCAN_LOCK_KEY = "sandbox:cron-prewarm:scan-lock";

    private final SandboxCronPrewarmService cronPrewarmService;

    private final SandboxCronPrewarmProperties properties;

    public SandboxCronPrewarmJob(SandboxCronPrewarmService cronPrewarmService,
        SandboxCronPrewarmProperties properties) {
        this.cronPrewarmService = cronPrewarmService;
        this.properties = properties;
    }

    @Scheduled(fixedDelayString = "${sandbox.cron-prewarm.fixed-delay:60000}",
        initialDelayString = "${sandbox.cron-prewarm.initial-delay:5000}",
        scheduler = SandboxJobSchedulerConfiguration.SANDBOX_JOB_TASK_SCHEDULER)
    public void prewarmDueCronSandboxes() {
        String lockValue = UUID.randomUUID().toString();
        boolean locked = false;
        try {
            locked = Boolean.TRUE.equals(RedisUtil.lock(SCAN_LOCK_KEY, lockValue,
                properties.normalizedScanLockTtlSeconds()));
            if (!locked) {
                LOGGER.debug("OpenClaw cron 预热扫描任务已在其他实例执行，跳过本轮");
                return;
            }
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
        finally {
            if (locked) {
                RedisUtil.releaseLock(SCAN_LOCK_KEY, lockValue);
            }
        }
    }
}
