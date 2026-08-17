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

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
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
    /** 运营资料采集与研发渠道共用扫描调度器，但进入独立的运营任务生成链路。 */
    private static final String SOURCE_TYPE_OPERATION_COLLECT = ScanSourceService.OPERATION_SOURCE_TYPE_COLLECT;

    private static final String SOURCE_TYPE_CHAT = ScanSourceService.SOURCE_TYPE_CHAT;

    private static final DateTimeFormatter DATE_TIME_FORMATTER = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private static final DateTimeFormatter DATE_FORMATTER = DateTimeFormatter.ofPattern("yyyy-MM-dd");

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
        if (ScanSourceService.OPERATION_SOURCE_TYPES.contains(type)
            && !SOURCE_TYPE_OPERATION_COLLECT.equals(type)) {
            // 内容创作和数据分析是运营需求类型，但不属于可定时采集的数据源。
            return;
        }
        List<com.iwhalecloud.byai.manager.entity.devloop.ScanRequireItem> newItems;
        switch (type) {
            case SOURCE_TYPE_OPERATION_COLLECT:
                // 运营采集到点后生成待执行会话，不进入研发需求的拆分、评分和自动派生链路。
                devloopApplicationService.executeOperationSourceSchedule(source);
                return;
            case SOURCE_TYPE_CHAT:
                // 定时聊天没有外部数据源，到点直接按存好的 chat 入参发起会话。
                devloopApplicationService.executeChatSourceSchedule(source);
                return;
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
        if (SOURCE_TYPE_OPERATION_COLLECT.equals(source.getSourceType())) {
            return shouldExecuteOperationSource(source);
        }
        if (ScanSourceService.OPERATION_SOURCE_TYPES.contains(source.getSourceType())) {
            return false;
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

    /** 运营采集源支持单次、按间隔和按周期三种调度方式，并遵守可选的生效日期区间。 */
    private boolean shouldExecuteOperationSource(ScanSource source) {
        JSONObject config;
        try {
            config = StringUtils.isBlank(source.getConfig()) ? new JSONObject() : JSON.parseObject(source.getConfig());
        }
        catch (Exception exception) {
            logger.warn("[DevloopScanJob] 运营源配置解析失败，跳过 sourceId={}", source.getSourceId(), exception);
            return false;
        }
        LocalDateTime now = LocalDateTime.now(ZoneId.systemDefault());
        if (!isWithinOperationEffectiveRange(source, config, now.toLocalDate())) {
            return false;
        }
        // 旧版采集范围的结束时间继续兼容，避免已存在的周期需求升级后失去停用边界。
        String endTime = firstText(config, "endTime", "collectEnd");
        if (endTime != null) {
            try {
                LocalDateTime end = parseOperationDateTime(endTime);
                if (end != null && end.isBefore(now)) {
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
            String onceTime = firstText(config, "onceTime", "startTime", "collectStart");
            if (StringUtils.isBlank(onceTime)) {
                // 历史单次配置没有触发时间时仍沿用首次执行逻辑，新数据已由保存接口强制校验时间。
                return source.getLastScanTime() == null;
            }
            LocalDateTime triggerTime = parseOperationDateTime(onceTime);
            return source.getLastScanTime() == null && triggerTime != null && !now.isBefore(triggerTime);
        }
        if ("interval".equalsIgnoreCase(mode)) {
            if (!matchesOperationWeekday(config, "intervalWeekdays", now)) {
                return false;
            }
            // 间隔模式也必须命中保存到 cron_expr 的当前触发点，避免调度器每分钟轮询时重复执行。
            if (!shouldScanByCron(source, now)) {
                return false;
            }
            if (source.getLastScanTime() == null) {
                return true;
            }
            long intervalHours = parseLong(config.get("intervalHours"), 0L);
            if (intervalHours <= 0) {
                // 旧版间隔值继续兼容分钟和小时，保存后的新数据只会使用 intervalHours。
                long legacyInterval = parseLong(config.get("interval"), parseLong(config.get("intervalValue"), 0L));
                String unit = firstText(config, "intervalUnit", "unit");
                intervalHours = "minute".equalsIgnoreCase(unit) || "minutes".equalsIgnoreCase(unit)
                    ? Math.max(1L, (legacyInterval + 59L) / 60L) : legacyInterval;
            }
            LocalDateTime lastScan = LocalDateTime.ofInstant(source.getLastScanTime().toInstant(),
                ZoneId.systemDefault());
            return intervalHours > 0 && !lastScan.plusHours(intervalHours).isAfter(now);
        }
        if ("biweekly".equalsIgnoreCase(firstText(config, "periodType"))
            && !matchesBiweeklyCycle(source, config, now.toLocalDate())) {
            return false;
        }
        // 周期模式统一读取 byai_scan_source.cron_expr，具体年月日和星期由保存接口生成。
        return shouldScanByCron(source, now);
    }

    /** 判断运营调度是否处于可选生效区间内，超过结束日期后自动停用该源。 */
    private boolean isWithinOperationEffectiveRange(ScanSource source, JSONObject config, LocalDate currentDate) {
        LocalDate startDate = parseOperationDate(firstText(config, "effectiveStartDate"));
        LocalDate endDate = parseOperationDate(firstText(config, "effectiveEndDate"));
        if (startDate != null && currentDate.isBefore(startDate)) {
            return false;
        }
        if (endDate != null && currentDate.isAfter(endDate)) {
            ScanSource disabled = new ScanSource();
            disabled.setSourceId(source.getSourceId());
            disabled.setEnabled("0");
            scanSourceService.update(disabled);
            return false;
        }
        return true;
    }

    /** 星期统一使用 1=周一至 7=周日；历史配置没有星期限制时按每天处理。 */
    private boolean matchesOperationWeekday(JSONObject config, String fieldName, LocalDateTime now) {
        List<Integer> weekdays = parseIntegerList(config.get(fieldName));
        return weekdays.isEmpty() || weekdays.contains(now.getDayOfWeek().getValue());
    }

    /** 每双周以生效开始日期所在周为第一周，未配置开始日期时以需求创建周为基准。 */
    private boolean matchesBiweeklyCycle(ScanSource source, JSONObject config, LocalDate currentDate) {
        LocalDate anchorDate = parseOperationDate(firstText(config, "effectiveStartDate"));
        if (anchorDate == null && source.getCreateTime() != null) {
            anchorDate = source.getCreateTime().toInstant().atZone(ZoneId.systemDefault()).toLocalDate();
        }
        if (anchorDate == null) {
            return true;
        }
        LocalDate anchorMonday = anchorDate.with(TemporalAdjusters.previousOrSame(java.time.DayOfWeek.MONDAY));
        LocalDate currentMonday = currentDate.with(TemporalAdjusters.previousOrSame(java.time.DayOfWeek.MONDAY));
        long weeks = ChronoUnit.WEEKS.between(anchorMonday, currentMonday);
        return weeks >= 0 && weeks % 2 == 0;
    }

    private boolean shouldScanByCron(ScanSource source) {
        return shouldScanByCron(source, LocalDateTime.now(ZoneId.systemDefault()));
    }

    /** 仅当当前分钟命中 Cron 且尚未消费该触发点时执行，调用方可复用同一时间避免边界漂移。 */
    private boolean shouldScanByCron(ScanSource source, LocalDateTime now) {
        String cron = source.getCronExpr();
        if (StringUtils.isBlank(cron)) {
            return false;
        }
        try {
            CronExpression expr = CronExpression.parse(toSpringCron(cron));
            LocalDateTime currentMinute = now.withSecond(0).withNano(0);
            LocalDateTime currentTrigger = expr.next(currentMinute.minusMinutes(1));
            if (currentTrigger == null || currentTrigger.isAfter(currentMinute)) {
                return false;
            }
            if (source.getLastScanTime() == null) {
                return true;
            }
            LocalDateTime lastScan = LocalDateTime.ofInstant(source.getLastScanTime().toInstant(),
                ZoneId.systemDefault());
            // 双周或生效区间跳过的历史触发点不能在后续任意时间补跑，只允许当前分钟命中的 Cron 执行一次。
            return lastScan.isBefore(currentTrigger);
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

    private List<Integer> parseIntegerList(Object value) {
        List<Integer> result = new ArrayList<>();
        if (!(value instanceof Iterable<?> iterable)) {
            return result;
        }
        for (Object item : iterable) {
            try {
                result.add(Integer.valueOf(String.valueOf(item)));
            }
            catch (NumberFormatException ignored) {
                // 单个损坏的星期值不影响其余合法配置，保存接口会阻止新数据进入此分支。
            }
        }
        return result;
    }

    private LocalDateTime parseOperationDateTime(String value) {
        if (StringUtils.isBlank(value)) {
            return null;
        }
        try {
            return LocalDateTime.parse(value.trim(), DATE_TIME_FORMATTER);
        }
        catch (Exception exception) {
            LocalDate date = parseOperationDate(value);
            return date == null ? null : date.atStartOfDay();
        }
    }

    private LocalDate parseOperationDate(String value) {
        if (StringUtils.isBlank(value)) {
            return null;
        }
        try {
            return LocalDate.parse(value.trim(), DATE_FORMATTER);
        }
        catch (Exception exception) {
            return null;
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
