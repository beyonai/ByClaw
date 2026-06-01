package com.iwhalecloud.byai.manager.application.service.ecosystem;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.dto.ecosystem.EcosystemTaskCreateRequest;
import com.iwhalecloud.byai.manager.vo.ecosystem.EcosystemConnectorVo;
import com.iwhalecloud.byai.manager.vo.ecosystem.EcosystemSignalVo;
import com.iwhalecloud.byai.manager.vo.ecosystem.EcosystemTaskVo;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 生态采集任务服务，负责任务定义、列表查询、调度抢占和任务配置读取。
 *
 * @author qin.guoquan
 * @date 2026-06-01
 */
@Service
public class EcosystemTaskService extends EcosystemCollectionSupport {

    /**
     * 全局序列服务，用于生成生态采集任务 ID。
     */
    @Autowired
    private SequenceService sequenceService;

    /**
     * 连接配置服务，用于校验连接归属和固化运行时 Profile。
     */
    @Autowired
    private EcosystemConnectionService connectionService;

    /**
     * 创建生态采集任务，并持久化采集范围、入库目标、信号和调度配置。
     *
     * @param request 任务创建请求
     * @return 创建后的任务视图
     */
    @Transactional(rollbackFor = Exception.class)
    public EcosystemTaskVo createTask(EcosystemTaskCreateRequest request) {
        validateTaskCreateRequest(request);

        EcosystemConnectorVo connector = connectionService.findConnector(request.getConnectorCode());
        if (request.getConnectionId() != null) {
            connectionService.ensureConnectionOwned(request.getConnectionId(), connector.getConnectorCode());
        }
        EcosystemTaskVo task = buildTask(request, connector);
        ensureTaskConnectionConfigured(task, connector);
        Map<String, Object> taskOptions = buildTaskOptions(request, task);
        task.setOptions(taskOptions);
        jdbcTemplate.update("""
            INSERT INTO byai.bykc_ec_sync_task (
                task_id, task_name, connector_code, connection_id, owner_type, run_location, source_url,
                scope_config, target_type, target_config, signal_config, schedule_type, options,
                schedule_config, next_run_time, status, created_by, create_time, update_time
            ) VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSONB), ?, CAST(? AS JSONB), CAST(? AS JSONB), ?,
                CAST(? AS JSONB), CAST(? AS JSONB), ?, ?, ?, ?, ?)
            """,
            task.getTaskId(),
            task.getTaskName(),
            task.getConnectorCode(),
            task.getConnectionId(),
            task.getOwnerType(),
            task.getRunLocation(),
            task.getSourceUrl(),
            toJson(buildScopeConfig(request, task)),
            task.getImportTarget(),
            toJson(buildTargetConfig(request, task)),
            toJson(task.getSignals()),
            task.getScheduleType(),
            toJson(taskOptions),
            toJson(task.getScheduleConfig()),
            task.getNextRunTime(),
            task.getStatus(),
            currentUserId(),
            task.getCreateTime(),
            task.getCreateTime());
        return task;
    }

    private void ensureTaskConnectionConfigured(EcosystemTaskVo task, EcosystemConnectorVo connector) {
        String authType = defaultAuthType(connector, task.getCollectMode());
        if (requiresSavedConnection(authType) && task.getConnectionId() == null) {
            throw new IllegalArgumentException(i18n("ecosystem.error.connection.available.not.found"));
        }
    }

    /**
     * 查询当前用户的采集任务列表，并带出最近一次运行概览。
     *
     * @return 任务列表
     */
    public List<EcosystemTaskVo> listTasks() {
        return jdbcTemplate.query("""
            SELECT t.task_id, t.task_name, t.connector_code, NULL AS connector_name, t.owner_type, t.run_location,
                   t.connection_id, cn.connection_name, cn.status AS connection_status, cn.auth_type,
                   cn.last_check_time, t.source_url, CAST(t.scope_config AS TEXT) AS scope_config, t.target_type,
                   CAST(t.target_config AS TEXT) AS target_config, CAST(t.signal_config AS TEXT) AS signal_config,
                   t.schedule_type, CAST(t.options AS TEXT) AS options,
                   CAST(t.schedule_config AS TEXT) AS schedule_config, t.next_run_time,
                   t.last_scheduled_run_time, t.status, t.create_time,
                   r.run_id AS last_run_id, r.status AS last_run_status,
                   COALESCE(r.finished_at, r.started_at, r.create_time) AS last_run_time,
                   r.markdown_count AS last_markdown_count, r.failed_count AS last_failed_count
              FROM byai.bykc_ec_sync_task t
              LEFT JOIN byai.bykc_ec_connection cn ON cn.connection_id = t.connection_id
              LEFT JOIN byai.bykc_ec_sync_run r ON r.run_id = (
                    SELECT r2.run_id
                      FROM byai.bykc_ec_sync_run r2
                     WHERE r2.task_id = t.task_id
                     ORDER BY r2.create_time DESC, r2.run_id DESC
                     LIMIT 1
              )
             WHERE t.created_by = ?
             ORDER BY t.create_time DESC, t.task_id DESC
            """, taskRowMapper(), currentUserId());
    }

    /**
     * 更新任务状态，当前支持 CREATED、DISABLED、ARCHIVED。
     *
     * @param request 包含 taskId 和 status
     * @return 更新后的任务视图
     */
    @Transactional(rollbackFor = Exception.class)
    public EcosystemTaskVo updateTaskStatus(Map<String, Object> request) {
        if (request == null) {
            throw new IllegalArgumentException(i18n("ecosystem.error.task.status.request.empty"));
        }
        Long taskId = longValue(request.get("taskId"));
        String status = normalizeTaskStatus(stringValue(request.get("status")));
        if (taskId == null) {
            throw new IllegalArgumentException(i18n("ecosystem.error.task.id.empty"));
        }
        jdbcTemplate.update("""
            UPDATE byai.bykc_ec_sync_task
               SET status = ?, update_time = ?
             WHERE task_id = ? AND created_by = ?
            """, status, new Date(), taskId, currentUserId());
        return findTask(taskId);
    }

    /**
     * 按当前用户查询任务。
     */
    public EcosystemTaskVo findTask(Long taskId) {
        return findTask(taskId, currentUserId());
    }

    /**
     * 按指定用户查询任务，用于定时调度以任务创建人身份运行。
     */
    public EcosystemTaskVo findTask(Long taskId, Long userId) {
        List<EcosystemTaskVo> tasks = jdbcTemplate.query("""
            SELECT t.task_id, t.task_name, t.connector_code, NULL AS connector_name, t.owner_type, t.run_location,
                   t.connection_id, cn.connection_name, cn.status AS connection_status, cn.auth_type,
                   cn.last_check_time, t.source_url, CAST(t.scope_config AS TEXT) AS scope_config, t.target_type,
                   CAST(t.target_config AS TEXT) AS target_config, CAST(t.signal_config AS TEXT) AS signal_config,
                   t.schedule_type, CAST(t.options AS TEXT) AS options,
                   CAST(t.schedule_config AS TEXT) AS schedule_config, t.next_run_time,
                   t.last_scheduled_run_time, t.status, t.create_time,
                   r.run_id AS last_run_id, r.status AS last_run_status,
                   COALESCE(r.finished_at, r.started_at, r.create_time) AS last_run_time,
                   r.markdown_count AS last_markdown_count, r.failed_count AS last_failed_count
              FROM byai.bykc_ec_sync_task t
              LEFT JOIN byai.bykc_ec_connection cn ON cn.connection_id = t.connection_id
              LEFT JOIN byai.bykc_ec_sync_run r ON r.run_id = (
                    SELECT r2.run_id
                      FROM byai.bykc_ec_sync_run r2
                     WHERE r2.task_id = t.task_id
                     ORDER BY r2.create_time DESC, r2.run_id DESC
                     LIMIT 1
              )
             WHERE t.task_id = ? AND t.created_by = ?
            """, taskRowMapper(), taskId, userId);
        if (tasks.isEmpty()) {
            throw new IllegalArgumentException(i18n("ecosystem.error.task.not.found"));
        }
        return tasks.get(0);
    }

    /**
     * 按当前用户查询任务入库目标配置。
     */
    public Map<String, Object> findTaskTargetConfig(Long taskId) {
        return findTaskTargetConfig(taskId, currentUserId());
    }

    /**
     * 按指定用户查询任务入库目标配置。
     */
    public Map<String, Object> findTaskTargetConfig(Long taskId, Long userId) {
        List<String> configs = jdbcTemplate.query("""
            SELECT CAST(target_config AS TEXT)
              FROM byai.bykc_ec_sync_task
             WHERE task_id = ? AND created_by = ?
            """, (rs, rowNum) -> rs.getString(1), taskId, userId);
        if (configs.isEmpty()) {
            return Collections.emptyMap();
        }
        return fromJson(configs.get(0), MAP_TYPE, Collections.emptyMap());
    }

    /**
     * 查询任务调度配置。
     */
    public Map<String, Object> findTaskScheduleConfig(Long taskId, Long userId) {
        List<String> configs = jdbcTemplate.query("""
            SELECT CAST(schedule_config AS TEXT)
              FROM byai.bykc_ec_sync_task
             WHERE task_id = ? AND created_by = ?
            """, (rs, rowNum) -> rs.getString(1), taskId, userId);
        if (configs.isEmpty()) {
            return Collections.emptyMap();
        }
        return fromJson(configs.get(0), MAP_TYPE, Collections.emptyMap());
    }

    /**
     * 查询已到执行时间的定时任务。
     */
    public List<ScheduledTaskRef> listDueScheduledTasks() {
        return jdbcTemplate.query("""
            SELECT task_id, created_by, schedule_type
              FROM byai.bykc_ec_sync_task
             WHERE schedule_type IN ('daily', 'weekly')
               AND status IN ('CREATED', 'SUCCESS', 'FAILED')
               AND next_run_time IS NOT NULL
               AND next_run_time <= ?
             ORDER BY next_run_time ASC, task_id ASC
             LIMIT 10
            """, (rs, rowNum) -> new ScheduledTaskRef(
            rs.getLong("task_id"),
            rs.getLong("created_by"),
            rs.getString("schedule_type")), new Date());
    }

    /**
     * 抢占一个定时任务，避免并发调度重复启动。
     */
    public boolean lockScheduledTask(ScheduledTaskRef taskRef) {
        int updated = jdbcTemplate.update("""
            UPDATE byai.bykc_ec_sync_task
               SET status = 'RUNNING', update_time = ?
             WHERE task_id = ? AND created_by = ?
               AND schedule_type IN ('daily', 'weekly')
               AND status IN ('CREATED', 'SUCCESS', 'FAILED')
               AND next_run_time IS NOT NULL
               AND next_run_time <= ?
            """, new Date(), taskRef.taskId(), taskRef.createdBy(), new Date());
        return updated > 0;
    }

    /**
     * 定时任务启动失败时记录错误并计算下一次运行时间。
     */
    public void markScheduledRunFailure(ScheduledTaskRef taskRef, RuntimeException exception) {
        Map<String, Object> scheduleConfig = findTaskScheduleConfig(taskRef.taskId(), taskRef.createdBy());
        scheduleConfig = new LinkedHashMap<>(scheduleConfig);
        scheduleConfig.put("lastScheduleError", abbreviate(exception.getMessage(), 360));
        Date nextRunTime = resolveNextRunTime(taskRef.scheduleType(), scheduleConfig, new Date());
        jdbcTemplate.update("""
            UPDATE byai.bykc_ec_sync_task
               SET status = ?, schedule_config = CAST(? AS JSONB), next_run_time = ?,
                   last_scheduled_run_time = ?, update_time = ?
             WHERE task_id = ? AND created_by = ?
            """, STATUS_FAILED, toJson(withNextRunTime(scheduleConfig, nextRunTime)), nextRunTime,
            new Date(), new Date(), taskRef.taskId(), taskRef.createdBy());
    }

    /**
     * 根据运行 ID 查询所属任务 ID，并校验归属当前用户。
     */
    public Long findRunTaskId(Long runId) {
        List<Long> taskIds = jdbcTemplate.query("""
            SELECT r.task_id
              FROM byai.bykc_ec_sync_run r
              JOIN byai.bykc_ec_sync_task t ON t.task_id = r.task_id
             WHERE r.run_id = ? AND t.created_by = ?
            """, (rs, rowNum) -> rs.getLong("task_id"), runId, currentUserId());
        if (taskIds.isEmpty()) {
            throw new IllegalArgumentException(i18n("ecosystem.error.run.not.found"));
        }
        return taskIds.get(0);
    }

    /**
     * 临时切换 CurrentUserHolder，用任务创建人的身份执行定时采集。
     */
    public void runAsUser(Long userId, Runnable runnable) {
        LoginInfo previousLoginInfo = CurrentUserHolder.getLoginInfo();
        LoginInfo scheduleLoginInfo = new LoginInfo();
        scheduleLoginInfo.setUserId(userId);
        scheduleLoginInfo.setUserCode("schedule-" + userId);
        scheduleLoginInfo.setUserName(i18n("ecosystem.scheduler.user.name"));
        CurrentUserHolder.setLoginInfo(scheduleLoginInfo);
        try {
            runnable.run();
        }
        finally {
            if (previousLoginInfo == null) {
                CurrentUserHolder.clearLoginInfo();
            }
            else {
                CurrentUserHolder.setLoginInfo(previousLoginInfo);
            }
        }
    }

    /**
     * 将创建请求和连接器能力合成为任务视图。
     */
    private EcosystemTaskVo buildTask(EcosystemTaskCreateRequest request, EcosystemConnectorVo connector) {
        EcosystemTaskVo task = new EcosystemTaskVo();
        task.setTaskId(sequenceService.nextVal());
        task.setTaskName(defaultText(request.getTaskName(),
            i18n("ecosystem.collection.default.name", connector.getConnectorName())));
        task.setConnectorCode(connector.getConnectorCode());
        task.setConnectionId(request.getConnectionId());
        task.setSourceName(connector.getConnectorName());
        task.setSourceUrl(defaultText(request.getSourceUrl(), "-"));
        task.setScope(defaultText(request.getScope(), i18n("ecosystem.scope.recent")));
        task.setOwnerType(defaultText(request.getOwnerType(), "personal"));
        String collectMode = normalizeCollectMode(request.getCollectMode(), connector);
        task.setCollectMode(collectMode);
        task.setRunLocation(defaultText(request.getRunLocation(), defaultRunLocation(collectMode)));
        task.setScheduleType(defaultText(request.getScheduleType(), "once"));
        task.setScheduleTypeName(scheduleTypeName(task.getScheduleType()));
        task.setScheduleConfig(buildScheduleConfig(request, task.getScheduleType()));
        task.setNextRunTime(resolveNextRunTime(task.getScheduleType(), task.getScheduleConfig(), new Date()));
        task.setImportTarget(defaultText(request.getImportTarget(), "knowledgeBase"));
        task.setTargetName(resolveTargetName(request));
        task.setCatalogId(request.getCatalogId());
        task.setKnowledgeBaseId(request.getKnowledgeBaseId());
        task.setKnowledgeBaseResourceId(request.getKnowledgeBaseResourceId());
        task.setKnowledgeBaseName(request.getKnowledgeBaseName());
        task.setStatus(STATUS_CREATED);
        task.setCreateTime(new Date());
        task.setSignals(buildSignals(connector, request));
        return task;
    }

    /**
     * 构造任务扩展选项；采集模式放在 options 中，兼容平台 OpenCLI 和 Browser Bridge 模式。
     */
    private Map<String, Object> buildTaskOptions(EcosystemTaskCreateRequest request, EcosystemTaskVo task) {
        Map<String, Object> options = new LinkedHashMap<>(defaultMap(request.getOptions()));
        putIfPresent(options, "collectMode", task.getCollectMode());
        Map<String, Object> runtimeConfig = connectionService.findRuntimeConfig(request.getConnectionId());
        if (!runtimeConfig.isEmpty()) {
            // 把连接上的运行时配置固化到任务，确保定时任务脱离当前请求后仍能使用同一浏览器 Profile。
            options.put("runtimeConfig", runtimeConfig);
            putIfPresent(options, "openCliProfile", runtimeConfig.get("openCliProfile"));
            putIfPresent(options, "chromeProfile", runtimeConfig.get("chromeProfile"));
        }
        return options;
    }

    /**
     * 根据连接器、业务对象标注、标签、范围和隐私策略生成分层信号。
     */
    private List<EcosystemSignalVo> buildSignals(EcosystemConnectorVo connector, EcosystemTaskCreateRequest request) {
        Map<String, EcosystemSignalVo> signals = new LinkedHashMap<>();
        putSignal(signals, "source", i18n("ecosystem.signal.type.source"), connector.getConnectorCode(),
            connector.getConnectorName(), 1.0, "connector");
        putObjectSignal(signals, "project", i18n("ecosystem.signal.object.project"), request.getProject());
        putObjectSignal(signals, "product", i18n("ecosystem.signal.object.product"), request.getProduct());
        putObjectSignal(signals, "customer", i18n("ecosystem.signal.object.customer"), request.getCustomer());
        putObjectSignal(signals, "domain", i18n("ecosystem.signal.object.domain"), request.getDomain());

        if (request.getSignalTags() != null) {
            for (String tag : request.getSignalTags()) {
                if (!isBlank(tag)) {
                    putSignal(signals, "topic", i18n("ecosystem.signal.type.topic"), normalizeCode(tag), tag.trim(),
                        0.86, "user");
                }
            }
        }

        String scope = defaultText(request.getScope(), "");
        String contentSignal = resolveContentSignal(scope);
        putSignal(signals, "content_type", i18n("ecosystem.signal.type.content.type"), normalizeCode(contentSignal),
            contentSignal, 0.76, "rule");
        putSignal(signals, "privacy", i18n("ecosystem.signal.type.privacy"), resolvePrivacyCode(request),
            resolvePrivacyName(request), 0.9, "rule");
        putSignal(signals, "action", i18n("ecosystem.signal.type.action"), "action_confirm",
            i18n("ecosystem.signal.action.confirm"), 0.72, "rule");
        return new ArrayList<>(signals.values());
    }
}
