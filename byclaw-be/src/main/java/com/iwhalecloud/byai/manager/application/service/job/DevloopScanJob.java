package com.iwhalecloud.byai.manager.application.service.job;

import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.manager.domain.devloop.service.DingtalkScanService;
import com.iwhalecloud.byai.manager.domain.devloop.service.GitHubIssueScanService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ScanSourceService;
import com.iwhalecloud.byai.manager.entity.devloop.ScanSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.scheduling.support.CronExpression;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.Date;
import java.util.List;
import java.util.UUID;

/**
 * 研发闭环定时扫描任务
 * 通过Redis分布式锁保证集群单节点执行，按配置cron周期扫描所有启用的需求源
 */
@Component
@ConditionalOnProperty(
    prefix = "devloop.scan",
    name = "enabled",
    havingValue = "true",
    matchIfMissing = false)
public class DevloopScanJob {

    private static final Logger logger =
        LoggerFactory.getLogger(DevloopScanJob.class);

    private static final String SOURCE_TYPE_GITHUB_ISSUE = "github_issue";
    private static final String SOURCE_TYPE_DINGTALK = "dingtalk";

    @Value("${devloop.scan.lockTimeout:120}")
    private int lockTimeout;

    @Autowired
    private ScanSourceService scanSourceService;

    @Autowired
    private GitHubIssueScanService gitHubIssueScanService;

    @Autowired
    private DingtalkScanService dingtalkScanService;

    @Autowired
    private DevloopPatService patService;

    /** 定时扫描入口，获取分布式锁后遍历所有启用源执行扫描 */
    @Scheduled(cron = "${devloop.scan.cron:0 */10 * * * ?}")
    public void executeScan() {
        String lockKey = "devloop:scan:lock";
        String lockValue = UUID.randomUUID().toString();
        boolean locked = false;

        try {
            locked = RedisUtil.lock(lockKey, lockValue, lockTimeout);
            if (!locked) {
                logger.debug("[DevloopScanJob] Another node is running, skip");
                return;
            }

            List<ScanSource> sources = scanSourceService.listEnabledSources();
            logger.info("[DevloopScanJob] Found {} enabled sources", sources.size());

            for (ScanSource source : sources) {
                if (!shouldScanNow(source)) {
                    continue;
                }
                try {
                    doScan(source);
                } catch (Exception e) {
                    logger.error("[DevloopScanJob] Scan failed for source: {}",
                        source.getSourceId(), e);
                }
            }
        } finally {
            if (locked) {
                RedisUtil.releaseLock(lockKey, lockValue);
            }
        }
    }

    /** 根据源类型分派到对应扫描服务 */
    private void doScan(ScanSource source) {
        String type = source.getSourceType();
        switch (type) {
            case SOURCE_TYPE_GITHUB_ISSUE:
                String pat = patService.getGitHubPat(source.getCreateBy());
                if (pat == null || pat.isEmpty()) {
                    logger.warn("[DevloopScanJob] No GitHub PAT for user: {}",
                        source.getCreateBy());
                    return;
                }
                gitHubIssueScanService.scan(source, pat);
                break;
            case SOURCE_TYPE_DINGTALK:
                dingtalkScanService.scan(source);
                break;
            default:
                logger.warn("[DevloopScanJob] Unknown source type: {}", type);
        }
    }

    /**
     * 判断当前源是否到达自身 cron 配置的下一个触发点。
     * 以 lastScanTime 为基准算下一次应扫时间，已过则该扫。
     * 未配置 cron、首次扫描、或 cron 解析失败时，默认扫描（避免漏扫）。
     */
    private boolean shouldScanNow(ScanSource source) {
        String cron = source.getCronExpr();
        if (cron == null || cron.isEmpty()) {
            return true;
        }
        Date lastScan = source.getLastScanTime();
        if (lastScan == null) {
            return true;
        }
        try {
            CronExpression expr = CronExpression.parse(toSpringCron(cron));
            LocalDateTime last = LocalDateTime.ofInstant(lastScan.toInstant(), ZoneId.systemDefault());
            LocalDateTime nextDue = expr.next(last);
            return nextDue != null && !nextDue.isAfter(LocalDateTime.now());
        } catch (Exception e) {
            logger.warn("[DevloopScanJob] Invalid cron '{}' for source {}, scanning anyway",
                cron, source.getSourceId(), e);
            return true;
        }
    }

    /**
     * 前端存 5 段 Unix cron（分 时 日 月 周），Spring CronExpression 要求 6 段（含秒）。
     * 5 段时前补 "0" 秒位；已是 6 段则原样返回。
     */
    private String toSpringCron(String cron) {
        String trimmed = cron.trim();
        String[] parts = trimmed.split("\\s+");
        return parts.length == 5 ? "0 " + trimmed : trimmed;
    }
}
