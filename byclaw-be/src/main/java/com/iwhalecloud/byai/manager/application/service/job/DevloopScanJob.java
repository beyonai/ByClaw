package com.iwhalecloud.byai.manager.application.service.job;

import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.manager.domain.devloop.service.DingtalkScanService;
import com.iwhalecloud.byai.manager.domain.devloop.service.DingtalkTodoScanService;
import com.iwhalecloud.byai.manager.domain.devloop.service.GitHubIssueScanService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ScanSourceService;
import com.iwhalecloud.byai.manager.entity.devloop.ScanSource;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.scheduling.support.CronExpression;
import org.apache.commons.lang3.StringUtils;
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
    matchIfMissing = true)
public class DevloopScanJob {

    private static final Logger logger =
        LoggerFactory.getLogger(DevloopScanJob.class);

    private static final String SOURCE_TYPE_GITHUB_ISSUE = "github_issue";
    private static final String SOURCE_TYPE_DINGTALK = "dingtalk";
    private static final String SOURCE_TYPE_DINGTALK_TODO = "dingtalk_todo";

    @Value("${devloop.scan.lockTimeout:120}")
    private int lockTimeout;

    @Autowired
    private ScanSourceService scanSourceService;

    @Autowired
    private GitHubIssueScanService gitHubIssueScanService;

    @Autowired
    private DingtalkScanService dingtalkScanService;

    @Autowired
    private DingtalkTodoScanService dingtalkTodoScanService;

    @Autowired
    private DevloopPatService patService;

    @Autowired
    private com.iwhalecloud.byai.manager.application.service.devloop.DevloopApplicationService devloopApplicationService;

    @Autowired
    private com.iwhalecloud.byai.manager.domain.devloop.service.DevloopScoringService scoringService;

    /**
     * 定时扫描入口，获取分布式锁后遍历所有启用源执行扫描。
     * job 每分钟醒一次做「检查」，真正是否扫由各源 cronExpr 决定；这也是源扫描频率的精度上限（最低每分钟）。
     */
    @Scheduled(cron = "${devloop.scan.cron:0 * * * * ?}")
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

    /** 根据源类型分派到对应扫描服务，扫描后按确认规则自动派生任务 */
    private void doScan(ScanSource source) {
        String type = source.getSourceType();
        if (ScanSourceService.OPERATION_SOURCE_TYPES.contains(type)) {
            // 运营源不进入钉钉/GitHub 扫描链路，只按运营配置生成待执行会话。
            devloopApplicationService.executeOperationSourceSchedule(source);
            return;
        }
        List<com.iwhalecloud.byai.manager.entity.devloop.ScanRequireItem> newItems;
        switch (type) {
            case SOURCE_TYPE_GITHUB_ISSUE:
                String pat = patService.getGitHubPat(source.getCreateBy());
                if (pat == null || pat.isEmpty()) {
                    logger.warn("[DevloopScanJob] No GitHub PAT for user: {}",
                        source.getCreateBy());
                    return;
                }
                newItems = gitHubIssueScanService.scan(source, pat);
                break;
            case SOURCE_TYPE_DINGTALK:
                newItems = dingtalkScanService.scan(source);
                break;
            case SOURCE_TYPE_DINGTALK_TODO:
                newItems = dingtalkTodoScanService.scan(source);
                break;
            default:
                logger.warn("[DevloopScanJob] Unknown source type: {}", type);
                return;
        }
        // 一次 LLM 调用完成拆分+评分：一条消息里的多个独立需求被拆开，各自打分；
        // 返回派发列表（子需求 + 未拆分条，不含被拆分的原始条），再按确认规则自动派生。
        List<com.iwhalecloud.byai.manager.entity.devloop.ScanRequireItem> dispatchItems = scoringService
            .splitAndScore(newItems);
        devloopApplicationService.autoDeriveForSource(source, dispatchItems);
    }

    /**
     * 判断当前源是否到达自身 cron 配置的下一个触发点。
     * 以 lastScanTime 为基准算下一次应扫时间，已过则该扫。
     * 未配置 cron、首次扫描、或 cron 解析失败时，默认扫描（避免漏扫）。
     */
    private boolean shouldScanNow(ScanSource source) {
        if (ScanSourceService.OPERATION_SOURCE_TYPES.contains(source.getSourceType())) {
            return shouldExecuteOperationSource(source);
        }
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

    /** 运营源支持单次、按间隔和按 Cron 周期三种调度方式，并在采集结束时间后自动停用。 */
    private boolean shouldExecuteOperationSource(ScanSource source) {
        JSONObject config;
        try {
            config = StringUtils.isBlank(source.getConfig()) ? new JSONObject() : JSON.parseObject(source.getConfig());
        }
        catch (Exception exception) {
            logger.warn("[DevloopScanJob] 运营源配置解析失败，跳过 sourceId={}", source.getSourceId(), exception);
            return false;
        }
        Date now = new Date();
        String endTime = firstText(config, "endTime", "collectEnd");
        if (endTime != null) {
            try {
                Date end = new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss").parse(endTime);
                if (end.before(now)) {
                    ScanSource disabled = new ScanSource();
                    disabled.setSourceId(source.getSourceId());
                    disabled.setEnabled("0");
                    scanSourceService.update(disabled);
                    return false;
                }
            }
            catch (Exception exception) {
                logger.debug("[DevloopScanJob] 运营源结束时间无法解析，继续按调度配置判断 sourceId={}", source.getSourceId());
            }
        }
        String mode = firstText(config, "mode", "collectMethod");
        if (StringUtils.isBlank(mode)) {
            // 内容创作和数据分析暂未配置周期触发时，只保留人工确认创建的运营任务。
            return false;
        }
        if ("once".equalsIgnoreCase(mode)) {
            return source.getLastScanTime() == null;
        }
        if ("interval".equalsIgnoreCase(mode)) {
            if (source.getLastScanTime() == null) {
                return true;
            }
            long interval = parseLong(config.get("interval"), parseLong(config.get("intervalValue"), 0L));
            String unit = firstText(config, "intervalUnit", "unit");
            long intervalMillis = "hour".equalsIgnoreCase(unit) || "hours".equalsIgnoreCase(unit)
                ? interval * 60L * 60L * 1000L : interval * 60L * 1000L;
            return interval > 0 && source.getLastScanTime().getTime() + intervalMillis <= now.getTime();
        }
        // periodic 默认沿用扫描源 cron_expr；没有 Cron 时按首次执行处理，避免运营需求永久不生成任务。
        return shouldScanByCron(source);
    }

    private boolean shouldScanByCron(ScanSource source) {
        String cron = source.getCronExpr();
        if (StringUtils.isBlank(cron) || source.getLastScanTime() == null) {
            return true;
        }
        try {
            CronExpression expr = CronExpression.parse(toSpringCron(cron));
            LocalDateTime last = LocalDateTime.ofInstant(source.getLastScanTime().toInstant(), ZoneId.systemDefault());
            LocalDateTime nextDue = expr.next(last);
            return nextDue != null && !nextDue.isAfter(LocalDateTime.now());
        }
        catch (Exception exception) {
            logger.warn("[DevloopScanJob] Invalid operation cron '{}' for source {}, skip", cron, source.getSourceId());
            return false;
        }
    }

    private String firstText(JSONObject config, String... keys) {
        for (String key : keys) {
            Object value = config.get(key);
            if (value != null && StringUtils.isNotBlank(String.valueOf(value))) {
                return String.valueOf(value).trim();
            }
        }
        return null;
    }

    private long parseLong(Object value, long fallback) {
        try {
            return value == null ? fallback : Long.parseLong(String.valueOf(value));
        }
        catch (NumberFormatException exception) {
            return fallback;
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
