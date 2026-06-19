package com.iwhalecloud.byai.manager.application.service.ecosystem;

import java.math.BigDecimal;
import java.net.URLEncoder;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.nio.charset.StandardCharsets;
import java.time.DayOfWeek;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.dto.ecosystem.EcosystemAgentHeartbeatRequest;
import com.iwhalecloud.byai.manager.dto.ecosystem.EcosystemRunStartRequest;
import com.iwhalecloud.byai.manager.dto.ecosystem.EcosystemTaskCreateRequest;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.vo.ecosystem.EcosystemAgentStatusVo;
import com.iwhalecloud.byai.manager.vo.ecosystem.EcosystemConnectorVo;
import com.iwhalecloud.byai.manager.vo.ecosystem.EcosystemRunVo;
import com.iwhalecloud.byai.manager.vo.ecosystem.EcosystemSignalVo;
import com.iwhalecloud.byai.manager.vo.ecosystem.EcosystemTaskVo;
import com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 生态采集 P0 应用服务。
 * @author qin.guoquan
 * @date 2026-05-29 21:12:18
 */
@Service
public class EcosystemCollectionApplicationService {

    /**
     * 任务或步骤已创建，尚未运行。
     */
    private static final String STATUS_CREATED = "CREATED";

    /**
     * 任务、步骤或运行成功。
     */
    private static final String STATUS_SUCCESS = "SUCCESS";

    /**
     * 任务、步骤或运行失败。
     */
    private static final String STATUS_FAILED = "FAILED";

    /**
     * 步骤被跳过，例如本次没有附件。
     */
    private static final String STATUS_SKIPPED = "SKIPPED";

    /**
     * 任务已禁用，不允许调度或手动运行。
     */
    private static final String STATUS_DISABLED = "DISABLED";

    /**
     * 任务已归档，不参与列表主流程和调度。
     */
    private static final String STATUS_ARCHIVED = "ARCHIVED";

    /**
     * JSON 字符串列表反序列化类型。
     */
    private static final TypeReference<List<String>> STRING_LIST_TYPE = new TypeReference<>() {
    };

    /**
     * 分层信号列表反序列化类型。
     */
    private static final TypeReference<List<EcosystemSignalVo>> SIGNAL_LIST_TYPE = new TypeReference<>() {
    };

    /**
     * 本机采集端站点登录态列表反序列化类型。
     */
    private static final TypeReference<List<EcosystemAgentStatusVo.SiteSessionVo>> SITE_SESSION_LIST_TYPE =
        new TypeReference<>() {
        };

    /**
     * 通用 JSON 对象反序列化类型。
     */
    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {
    };

    /**
     * 通用 JSON 对象列表反序列化类型。
     */
    private static final TypeReference<List<Map<String, Object>>> MAP_LIST_TYPE = new TypeReference<>() {
    };

    /**
     * 轻量 SQL 访问入口，生态采集 P0/P1 表当前直接通过 JdbcTemplate 编排。
     */
    @Autowired
    private JdbcTemplate jdbcTemplate;

    /**
     * JSON 序列化器，用于读写 JSONB 配置字段。
     */
    @Autowired
    private ObjectMapper objectMapper;

    /**
     * 全局序列服务，用于生成任务、运行、步骤、产物和信号 ID。
     */
    @Autowired
    private SequenceService sequenceService;

    /**
     * OpenCLI 运行器，负责实际调用底层采集运行时。
     */
    @Autowired
    private OpenCliRunner openCliRunner;

    /**
     * 采集产物存储服务，负责 Markdown、附件、raw、manifest 落对象存储和 files 表。
     */
    @Autowired
    private EcosystemArtifactStorageService artifactStorageService;

    /**
     * 知识库导入服务，负责把 Markdown 文件上传到知识库并触发索引构建。
     */
    @Autowired
    private EcosystemKnowledgeImportService knowledgeImportService;

    /**
     * 知识库应用服务，用于查询/创建默认个人知识库。
     */
    @Autowired
    private DatasetApplicationService datasetApplicationService;

    /**
     * 查询启用的生态连接器能力清单。
     *
     * @return 连接器视图列表
     */
    public List<EcosystemConnectorVo> listConnectors() {
        return jdbcTemplate.query("""
            SELECT connector_code, connector_name, category, run_locations::text AS run_locations,
                   auth_types::text AS auth_types, capability_schema::text AS capability_schema,
                   runtime_type, status, description
              FROM byai.bykc_ec_connector
             WHERE status = 'ENABLED'
             ORDER BY connector_id
            """, connectorRowMapper());
    }

    /**
     * 获取当前用户最近一次本机采集端状态；没有心跳时返回离线默认状态。
     *
     * @return 本机采集端状态
     */
    public EcosystemAgentStatusVo getLocalAgentStatus() {
        List<EcosystemAgentStatusVo> statuses = jdbcTemplate.query("""
            SELECT agent_name, runtime_name, runtime_version, browser_bridge_status, chrome_profile, status,
                   last_heartbeat_time, site_sessions::text AS site_sessions
              FROM byai.bykc_ec_collector_agent
             WHERE user_id = ?
             ORDER BY update_time DESC, agent_id DESC
             LIMIT 1
            """, agentStatusRowMapper(), currentUserId());
        if (statuses.isEmpty()) {
            return offlineAgentStatus();
        }
        return statuses.get(0);
    }

    /**
     * 查询当前用户的连接配置，可按连接器编码过滤。
     *
     * @param connectorCode 连接器编码，可为空
     * @return 连接配置安全视图列表
     */
    public List<Map<String, Object>> listConnections(String connectorCode) {
        if (isBlank(connectorCode)) {
            return jdbcTemplate.query("""
                SELECT connection_id, connector_code, owner_type, auth_type, connection_name, run_location,
                       credential_config::text AS credential_config, runtime_config::text AS runtime_config,
                       site_sessions::text AS site_sessions, status, last_check_time, create_time
                  FROM byai.bykc_ec_connection
                 WHERE created_by = ?
                 ORDER BY update_time DESC, connection_id DESC
                """, connectionRowMapper(), currentUserId());
        }
        return jdbcTemplate.query("""
            SELECT connection_id, connector_code, owner_type, auth_type, connection_name, run_location,
                   credential_config::text AS credential_config, runtime_config::text AS runtime_config,
                   site_sessions::text AS site_sessions, status, last_check_time, create_time
              FROM byai.bykc_ec_connection
             WHERE created_by = ? AND LOWER(connector_code) = LOWER(?)
             ORDER BY update_time DESC, connection_id DESC
            """, connectionRowMapper(), currentUserId(), connectorCode.trim());
    }

    /**
     * 保存连接配置。明文 Token 只在写入时接收，返回时只返回脱敏状态。
     *
     * @param request 连接配置请求
     * @return 保存后的连接安全视图
     */
    @Transactional(rollbackFor = Exception.class)
    public Map<String, Object> saveConnection(Map<String, Object> request) {
        if (request == null) {
            throw new IllegalArgumentException(i18n("ecosystem.error.connection.config.empty"));
        }
        String connectorCode = defaultText(stringValue(request.get("connectorCode")), "");
        if (isBlank(connectorCode)) {
            throw new IllegalArgumentException(i18n("ecosystem.error.connector.empty"));
        }
        EcosystemConnectorVo connector = findConnector(connectorCode);
        Long connectionId = longValue(request.get("connectionId"));
        if (connectionId != null) {
            ensureConnectionOwned(connectionId, connector.getConnectorCode());
        } else {
            connectionId = sequenceService.nextVal();
        }

        String authType = defaultText(stringValue(request.get("authType")), firstOrDefault(connector.getAuthTypes(),
            connector.getRequiresLocalAgent() ? "BROWSER" : "PUBLIC_URL"));
        String runLocation = defaultText(stringValue(request.get("runLocation")), firstOrDefault(
            connector.getRunLocations(), connector.getRequiresLocalAgent() ? "LOCAL" : "SERVER"));
        String connectionName = defaultText(stringValue(request.get("connectionName")),
            i18n("ecosystem.connection.default.name", connector.getConnectorName()));
        Map<String, Object> credentialConfig = buildCredentialConfig(connectionId, request);
        Map<String, Object> runtimeConfig = buildRuntimeConfig(request);
        Object siteSessions = request.get("siteSessions") instanceof List<?> ? request.get("siteSessions") : List.of();
        String status = resolveConnectionStatus(authType, credentialConfig);
        Date now = new Date();

        int updated = jdbcTemplate.update("""
            UPDATE byai.bykc_ec_connection
               SET auth_type = ?, connection_name = ?, run_location = ?,
                   credential_config = CAST(? AS JSONB), runtime_config = CAST(? AS JSONB),
                   site_sessions = CAST(? AS JSONB), status = ?, last_check_time = ?,
                   update_time = ?
             WHERE connection_id = ? AND created_by = ?
            """,
            authType,
            connectionName,
            runLocation,
            toJson(credentialConfig),
            toJson(runtimeConfig),
            toJson(siteSessions),
            status,
            now,
            now,
            connectionId,
            currentUserId());
        if (updated == 0) {
            jdbcTemplate.update("""
                INSERT INTO byai.bykc_ec_connection (
                    connection_id, connector_code, owner_type, auth_type, connection_name, run_location,
                    credential_config, runtime_config, site_sessions, status, last_check_time,
                    created_by, create_time, update_time
                ) VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSONB), CAST(? AS JSONB), CAST(? AS JSONB), ?, ?, ?, ?, ?)
                """,
                connectionId,
                connector.getConnectorCode(),
                "PERSONAL",
                authType,
                connectionName,
                runLocation,
                toJson(credentialConfig),
                toJson(runtimeConfig),
                toJson(siteSessions),
                status,
                now,
                currentUserId(),
                now,
                now);
        }
        return findConnectionView(connectionId);
    }

    /**
     * 创建生态采集任务，并持久化采集范围、入库目标、信号和调度配置。
     *
     * @param request 任务创建请求
     * @return 创建后的任务视图
     */
    @Transactional(rollbackFor = Exception.class)
    public EcosystemTaskVo createTask(EcosystemTaskCreateRequest request) {
        validateTaskCreateRequest(request);

        EcosystemConnectorVo connector = findConnector(request.getConnectorCode());
        if (request.getConnectionId() != null) {
            ensureConnectionOwned(request.getConnectionId(), connector.getConnectorCode());
        }
        EcosystemTaskVo task = buildTask(request, connector);
        jdbcTemplate.update("""
            INSERT INTO byai.bykc_ec_sync_task (
                task_id, task_name, connector_code, connection_id, owner_type, run_location, source_url,
                scope_config, target_type, target_config, signal_config, schedule_type, options,
                schedule_config, next_run_time, allow_enterprise_memory, status, created_by, create_time, update_time
            ) VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSONB), ?, CAST(? AS JSONB), CAST(? AS JSONB), ?,
                CAST(? AS JSONB), CAST(? AS JSONB), ?, ?, ?, ?, ?, ?)
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
            toJson(defaultMap(request.getOptions())),
            toJson(task.getScheduleConfig()),
            task.getNextRunTime(),
            "enterprise".equalsIgnoreCase(task.getOwnerType()),
            task.getStatus(),
            currentUserId(),
            task.getCreateTime(),
            task.getCreateTime());
        return task;
    }

    /**
     * 查询当前用户的采集任务列表，并带出最近一次运行概览。
     *
     * @return 任务列表
     */
    public List<EcosystemTaskVo> listTasks() {
        return jdbcTemplate.query("""
            SELECT t.task_id, t.task_name, t.connector_code, c.connector_name, t.owner_type, t.run_location,
                   t.connection_id, cn.connection_name, cn.status AS connection_status, cn.auth_type,
                   cn.last_check_time, t.source_url, t.scope_config::text AS scope_config, t.target_type,
                   t.target_config::text AS target_config, t.signal_config::text AS signal_config,
                   t.schedule_type, t.schedule_config::text AS schedule_config, t.next_run_time,
                   t.last_scheduled_run_time, t.status, t.create_time,
                   r.run_id AS last_run_id, r.status AS last_run_status,
                   COALESCE(r.finished_at, r.started_at, r.create_time) AS last_run_time,
                   r.markdown_count AS last_markdown_count, r.failed_count AS last_failed_count
              FROM byai.bykc_ec_sync_task t
              LEFT JOIN byai.bykc_ec_connector c ON c.connector_code = t.connector_code
              LEFT JOIN byai.bykc_ec_connection cn ON cn.connection_id = t.connection_id
              LEFT JOIN LATERAL (
                    SELECT run_id, status, started_at, finished_at, create_time, markdown_count, failed_count
                      FROM byai.bykc_ec_sync_run
                     WHERE task_id = t.task_id
                     ORDER BY create_time DESC, run_id DESC
                     LIMIT 1
              ) r ON TRUE
             WHERE t.created_by = ?
             ORDER BY t.create_time DESC, t.task_id DESC
            """, taskRowMapper(), currentUserId());
    }

    /**
     * 定时扫描到期任务并触发运行。该方法由 Spring Scheduler 调用。
     */
    @Scheduled(fixedDelayString = "${bykc.ecosystem.scheduler.fixed-delay-ms:60000}",
        initialDelayString = "${bykc.ecosystem.scheduler.initial-delay-ms:30000}")
    public void dispatchScheduledRuns() {
        for (ScheduledTaskRef taskRef : listDueScheduledTasks()) {
            if (!lockScheduledTask(taskRef)) {
                continue;
            }
            try {
                runAsUser(taskRef.createdBy(), () -> startRunInternal(taskRef.taskId(), "SCHEDULED",
                    taskRef.createdBy()));
            }
            catch (RuntimeException e) {
                markScheduledRunFailure(taskRef, e);
            }
        }
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
     * 手动启动一次采集运行。
     *
     * @param request 运行启动请求
     * @return 运行结果
     */
    public EcosystemRunVo startRun(EcosystemRunStartRequest request) {
        if (request == null || request.getTaskId() == null) {
            throw new IllegalArgumentException(i18n("ecosystem.error.task.id.empty"));
        }
        return startRunInternal(request.getTaskId(), defaultText(request.getTriggerType(), "MANUAL"), currentUserId());
    }

    /**
     * 采集运行主流程：OpenCLI 采集、产物落地、Markdown 入库、运行记录持久化、下次调度时间回写。
     */
    private EcosystemRunVo startRunInternal(Long taskId, String triggerType, Long userId) {
        EcosystemTaskVo task = findTask(taskId, userId);
        if (STATUS_DISABLED.equalsIgnoreCase(task.getStatus()) || STATUS_ARCHIVED.equalsIgnoreCase(task.getStatus())) {
            throw new IllegalArgumentException(i18n("ecosystem.error.task.not.runnable"));
        }
        Map<String, Object> targetConfig = findTaskTargetConfig(task.getTaskId(), userId);
        Long runId = sequenceService.nextVal();
        OpenCliRunner.CollectionResult collectionResult = null;
        EcosystemArtifactStorageService.StorageResult storageResult = null;
        EcosystemRunVo run;
        try {
            collectionResult = openCliRunner.collect(task, runId);
            storageResult = artifactStorageService.store(runId, task, collectionResult);
            EcosystemKnowledgeImportService.ImportResult importResult =
                knowledgeImportService.importMarkdown(task, targetConfig, storageResult.getMarkdownFiles());
            run = buildSuccessRun(runId, task, triggerType, collectionResult, storageResult, importResult);
        }
        catch (OpenCliRunner.OpenCliException e) {
            run = buildFailedRun(runId, task, e, collectionResult, storageResult);
        }
        catch (RuntimeException e) {
            run = buildFailedRun(runId, task, e, collectionResult, storageResult);
        }
            saveRun(run, task, triggerType, targetConfig);
        Date nextRunTime = resolveNextRunTime(task.getScheduleType(), task.getScheduleConfig(), new Date());
        Map<String, Object> scheduleConfig = withNextRunTime(task.getScheduleConfig(), nextRunTime);
        jdbcTemplate.update("""
            UPDATE byai.bykc_ec_sync_task
               SET status = ?, schedule_config = CAST(? AS JSONB), next_run_time = ?,
                   last_scheduled_run_time = CASE WHEN ? = 'SCHEDULED' THEN ? ELSE last_scheduled_run_time END,
                   update_time = ?
             WHERE task_id = ? AND created_by = ?
            """, run.getStatus(), toJson(scheduleConfig), nextRunTime, triggerType, new Date(), new Date(),
            task.getTaskId(), userId);
        return run;
    }

    /**
     * 接收本机采集端心跳并刷新状态。
     *
     * @param request 心跳请求
     * @return 最新采集端状态
     */
    public EcosystemAgentStatusVo heartbeat(EcosystemAgentHeartbeatRequest request) {
        EcosystemAgentHeartbeatRequest heartbeatRequest = request == null
            ? new EcosystemAgentHeartbeatRequest()
            : request;
        if (isBlank(heartbeatRequest.getRuntimeName())) {
            heartbeatRequest.setRuntimeName("OpenCLI");
        }
        if (isBlank(heartbeatRequest.getStatus())) {
            heartbeatRequest.setStatus("ONLINE");
        }
        upsertAgentHeartbeat(heartbeatRequest);
        return getLocalAgentStatus();
    }

    /**
     * 主动检测本机 OpenCLI 运行时，并把检测结果写成采集端状态。
     *
     * @return 检测后的采集端状态
     */
    public EcosystemAgentStatusVo detectLocalAgent() {
        OpenCliRunner.RuntimeStatus runtimeStatus = openCliRunner.inspectRuntime();
        EcosystemAgentHeartbeatRequest request = new EcosystemAgentHeartbeatRequest();
        request.setAgentName(i18n("ecosystem.local.agent.name", defaultUserName()));
        request.setRuntimeName(runtimeStatus.getRuntimeName());
        request.setRuntimeVersion(runtimeStatus.getRuntimeVersion());
        request.setBrowserBridgeStatus(runtimeStatus.getBrowserBridgeStatus());
        request.setChromeProfile("bykc-local");
        request.setStatus(runtimeStatus.getStatus());
        request.setSiteSessions(List.of());
        upsertAgentHeartbeat(request);
        return getLocalAgentStatus();
    }

    /**
     * 查询运行详情，并加载步骤、产物和信号明细。
     *
     * @param runId 运行 ID
     * @return 运行详情
     */
    public EcosystemRunVo getRun(Long runId) {
        if (runId == null) {
            throw new IllegalArgumentException(i18n("ecosystem.error.run.id.empty"));
        }
        List<EcosystemRunVo> runs = jdbcTemplate.query("""
            SELECT r.run_id, r.task_id, r.status, r.current_step, r.total_count, r.markdown_count, r.asset_count,
                   r.failed_count, r.need_action_type, r.need_action_payload::text AS need_action_payload,
                   r.storage_path, r.started_at, r.finished_at, t.target_config::text AS target_config
              FROM byai.bykc_ec_sync_run r
              JOIN byai.bykc_ec_sync_task t ON t.task_id = r.task_id
             WHERE r.run_id = ? AND t.created_by = ?
            """, runRowMapper(), runId, currentUserId());
        if (runs.isEmpty()) {
            throw new IllegalArgumentException(i18n("ecosystem.error.run.not.found"));
        }
        EcosystemRunVo run = runs.get(0);
        run.setSteps(listRunSteps(runId));
        run.setArtifacts(listRunArtifacts(runId));
        run.setSignals(listRunSignals(runId));
        return run;
    }

    /**
     * 处理运行中的用户动作，例如重试、重新检测本机采集端、跳过或确认。
     *
     * @param request 包含 runId 和 action
     * @return 处理后的运行详情
     */
    @Transactional(rollbackFor = Exception.class)
    public EcosystemRunVo handleRunAction(Map<String, Object> request) {
        if (request == null) {
            throw new IllegalArgumentException(i18n("ecosystem.error.run.action.request.empty"));
        }
        Long runId = longValue(request.get("runId"));
        String action = defaultText(stringValue(request.get("action")), "ACK").toUpperCase(Locale.ROOT);
        if (runId == null) {
            throw new IllegalArgumentException(i18n("ecosystem.error.run.id.empty"));
        }
        if ("RETRY".equals(action)) {
            Long taskId = findRunTaskId(runId);
            return startRunInternal(taskId, "RETRY", currentUserId());
        }
        if ("RECHECK_LOCAL_AGENT".equals(action)) {
            detectLocalAgent();
            return getRun(runId);
        }
        if ("SKIP".equals(action)) {
            jdbcTemplate.update("""
                UPDATE byai.bykc_ec_sync_run
                   SET status = ?, need_action_type = NULL,
                       need_action_payload = CAST(? AS JSONB), finished_at = ?
                 WHERE run_id = ? AND task_id IN (
                       SELECT task_id FROM byai.bykc_ec_sync_task WHERE created_by = ?
                 )
                """, STATUS_SKIPPED, toJson(Map.of(
                    "message", i18n("ecosystem.run.action.skipped.message"),
                    "actionStatus", "SKIPPED"
                )), new Date(), runId, currentUserId());
            jdbcTemplate.update("""
                UPDATE byai.bykc_ec_sync_run_step
                   SET status = ?, message = ?
                WHERE run_id = ? AND status = ?
                """, STATUS_SKIPPED, i18n("ecosystem.run.action.skipped.step"), runId, STATUS_FAILED);
            return getRun(runId);
        }
        jdbcTemplate.update("""
            UPDATE byai.bykc_ec_sync_run
               SET need_action_type = NULL,
                   need_action_payload = CAST(? AS JSONB)
             WHERE run_id = ? AND task_id IN (
                   SELECT task_id FROM byai.bykc_ec_sync_task WHERE created_by = ?
            )
            """, toJson(Map.of(
            "message", i18n("ecosystem.run.action.acked.message"),
            "actionStatus", "ACKED"
        )), runId, currentUserId());
        return getRun(runId);
    }

    /**
     * 聊天入口的采集计划构建，当前复用技能入口逻辑。
     */
    public Map<String, Object> buildChatPlan(Map<String, Object> request) {
        return buildSkillPlan(request);
    }

    /**
     * 技能入口采集计划构建，用于 OpenClaw 在真正执行前返回确认卡片。
     */
    public Map<String, Object> buildSkillPlan(Map<String, Object> request) {
        Map<String, Object> plan = normalizeChatPlan(request, false);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("plan", plan);
        result.put("ready", plan.get("ready"));
        result.put("missingActions", plan.get("missingActions"));
        result.put("card", buildChatPlanCard(plan));
        return result;
    }

    /**
     * 聊天入口确认采集，当前复用技能入口启动逻辑。
     */
    @Transactional(rollbackFor = Exception.class)
    public Map<String, Object> startChatCollection(Map<String, Object> request) {
        return startSkillCollection(request);
    }

    /**
     * 技能入口确认采集：根据计划创建任务，立即执行一次采集并返回任务/运行结果。
     */
    @Transactional(rollbackFor = Exception.class)
    public Map<String, Object> startSkillCollection(Map<String, Object> request) {
        Map<String, Object> plan = normalizeChatPlan(chatPlanPayload(request), true);
        if (!Boolean.TRUE.equals(plan.get("ready"))) {
            throw new IllegalArgumentException(i18n("ecosystem.error.skill.plan.not.ready", chatMissingActionText(plan)));
        }
        EcosystemTaskVo task = createTask(buildChatTaskRequest(plan));
        EcosystemRunVo run = startRunInternal(task.getTaskId(), "SKILL", currentUserId());

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("task", task);
        result.put("run", run);
        result.put("taskId", task.getTaskId());
        result.put("runId", run.getRunId());
        result.put("status", run.getStatus());
        result.put("targetName", run.getTargetName());
        result.put("message", i18n("ecosystem.skill.start.message", run.getTargetName()));
        return result;
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
        task.setRunLocation(defaultText(request.getRunLocation(), connector.getRequiresLocalAgent() ? "LOCAL" : "SERVER"));
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
     * 归一化聊天/技能采集计划，补齐来源、运行位置、默认知识库、连接配置和缺失动作。
     */
    private Map<String, Object> normalizeChatPlan(Map<String, Object> request, boolean createDefaultKnowledgeBase) {
        Map<String, Object> input = new LinkedHashMap<>(defaultMap(request));
        String rawText = defaultText(stringValue(input.get("originalText")), stringValue(input.get("text")));
        String sourceUrl = defaultText(stringValue(input.get("sourceUrl")), extractFirstUrl(rawText));
        String connectorCode = defaultText(stringValue(input.get("connectorCode")), inferConnectorCode(sourceUrl, rawText));
        EcosystemConnectorVo connector = findConnector(connectorCode);
        KnowledgeTarget knowledgeTarget = resolveKnowledgeTarget(input, createDefaultKnowledgeBase);
        Map<String, Object> connection = findPreferredConnection(connector.getConnectorCode());
        EcosystemAgentStatusVo agentStatus = getLocalAgentStatus();
        String authType = firstOrDefault(connector.getAuthTypes(), Boolean.TRUE.equals(connector.getRequiresLocalAgent())
            ? "BROWSER"
            : "PUBLIC_URL");
        String runLocation = defaultText(stringValue(input.get("runLocation")),
            Boolean.TRUE.equals(connector.getRequiresLocalAgent()) ? "LOCAL" : "SERVER");
        List<String> missingActions = new ArrayList<>();
        if (!isRuntimeSupportedForChat(connector.getConnectorCode())) {
            missingActions.add("UNSUPPORTED_RUNTIME");
        }
        if (requiresSourceUrl(connector.getConnectorCode()) && isBlank(sourceUrl)) {
            missingActions.add("SOURCE_URL");
        }
        if (Boolean.TRUE.equals(connector.getRequiresLocalAgent()) && !Boolean.TRUE.equals(agentStatus.getConnected())) {
            missingActions.add("LOCAL_AGENT");
        }
        if (requiresSavedConnection(authType) && !"READY".equalsIgnoreCase(text(connection, "status", ""))) {
            missingActions.add("CONNECTION");
        }
        if (createDefaultKnowledgeBase && knowledgeTarget.resourceId() == null) {
            missingActions.add("DEFAULT_KNOWLEDGE_BASE");
        }

        Map<String, Object> plan = new LinkedHashMap<>();
        plan.put("entry", "skill");
        putIfPresent(plan, "chatSessionId", input.get("chatSessionId"));
        putIfPresent(plan, "chatQueryMessageId", input.get("chatQueryMessageId"));
        putIfPresent(plan, "originalText", rawText);
        plan.put("taskName", defaultText(stringValue(input.get("taskName")),
            i18n("ecosystem.skill.collection.default.name", connector.getConnectorName())));
        plan.put("connectorCode", connector.getConnectorCode());
        plan.put("connectorName", connector.getConnectorName());
        plan.put("sourceUrl", sourceUrl);
        plan.put("scope", defaultText(stringValue(input.get("scope")),
            isBlank(sourceUrl) ? i18n("ecosystem.scope.recent") : i18n("ecosystem.scope.link")));
        plan.put("ownerType", "personal");
        plan.put("runLocation", runLocation);
        plan.put("runLocationName", runLocationName(runLocation));
        plan.put("authType", authType);
        plan.put("authTypeName", authTypeName(authType));
        plan.put("scheduleType", defaultText(stringValue(input.get("scheduleType")), "once"));
        plan.put("importTarget", "knowledgeBase");
        plan.put("catalogId", knowledgeTarget.catalogId());
        plan.put("knowledgeBaseId", knowledgeTarget.resourceId() == null ? null : String.valueOf(knowledgeTarget.resourceId()));
        plan.put("knowledgeBaseResourceId", knowledgeTarget.resourceId());
        plan.put("knowledgeBaseName", knowledgeTarget.resourceName());
        plan.put("targetName", i18n("ecosystem.target.personal.knowledge.base",
            defaultText(knowledgeTarget.resourceName(), i18n("ecosystem.default.knowledge.base"))));
        putIfPresent(plan, "connectionId", connection.get("connectionId"));
        putIfPresent(plan, "connectionName", connection.get("connectionName"));
        putIfPresent(plan, "project", input.get("project"));
        putIfPresent(plan, "product", input.get("product"));
        putIfPresent(plan, "customer", input.get("customer"));
        putIfPresent(plan, "domain", input.get("domain"));
        List<String> signalTags = stringList(input.get("signalTags"));
        if (signalTags.isEmpty()) {
            signalTags = List.of("ByKC", i18n("ecosystem.tag.collection"));
        }
        plan.put("signalTags", signalTags);
        plan.put("ready", missingActions.isEmpty());
        plan.put("missingActions", missingActions);
        plan.put("localAgent", agentStatus);
        plan.put("connection", connection);
        return plan;
    }

    /**
     * 将已确认的聊天/技能计划转换为任务创建请求。
     */
    private EcosystemTaskCreateRequest buildChatTaskRequest(Map<String, Object> plan) {
        EcosystemTaskCreateRequest request = new EcosystemTaskCreateRequest();
        request.setTaskName(stringValue(plan.get("taskName")));
        request.setConnectorCode(stringValue(plan.get("connectorCode")));
        request.setConnectionId(longValue(plan.get("connectionId")));
        request.setSourceUrl(stringValue(plan.get("sourceUrl")));
        request.setScope(stringValue(plan.get("scope")));
        request.setOwnerType("personal");
        request.setRunLocation(stringValue(plan.get("runLocation")));
        request.setScheduleType(stringValue(plan.get("scheduleType")));
        request.setImportTarget("knowledgeBase");
        request.setCatalogId(longValue(plan.get("catalogId")));
        request.setKnowledgeBaseId(stringValue(plan.get("knowledgeBaseId")));
        request.setKnowledgeBaseResourceId(longValue(plan.get("knowledgeBaseResourceId")));
        request.setKnowledgeBaseName(stringValue(plan.get("knowledgeBaseName")));
        request.setProject(stringValue(plan.get("project")));
        request.setProduct(stringValue(plan.get("product")));
        request.setCustomer(stringValue(plan.get("customer")));
        request.setDomain(stringValue(plan.get("domain")));
        request.setSignalTags(stringList(plan.get("signalTags")));

        Map<String, Object> options = new LinkedHashMap<>();
        options.put("entry", "skill");
        putIfPresent(options, "chatSessionId", plan.get("chatSessionId"));
        putIfPresent(options, "chatQueryMessageId", plan.get("chatQueryMessageId"));
        putIfPresent(options, "originalText", plan.get("originalText"));
        request.setOptions(options);
        return request;
    }

    /**
     * 构造聊天窗口内展示的采集确认卡片。
     */
    private Map<String, Object> buildChatPlanCard(Map<String, Object> plan) {
        String connectorName = text(plan, "connectorName", text(plan, "connectorCode", i18n("ecosystem.source.generic")));
        String targetName = text(plan, "targetName",
            i18n("ecosystem.target.personal.knowledge.base", i18n("ecosystem.default.knowledge.base")));
        String runLocation = text(plan, "runLocationName", "-");
        String authType = text(plan, "authTypeName", "-");
        String sourceUrl = text(plan, "sourceUrl", "");
        boolean ready = Boolean.TRUE.equals(plan.get("ready"));

        Map<String, Object> card = new LinkedHashMap<>();
        Map<String, Object> title = new LinkedHashMap<>();
        title.put("mainTitle", i18n("ecosystem.card.title", connectorName));
        title.put("subTitle", ready ? i18n("ecosystem.card.subtitle.ready")
            : i18n("ecosystem.card.subtitle.not.ready"));
        card.put("title", title);

        Map<String, Object> content = new LinkedHashMap<>();
        List<Map<String, Object>> blocks = new ArrayList<>();
        Map<String, Object> markdown = new LinkedHashMap<>();
        markdown.put("type", "markdown");
        markdown.put("text", "- " + i18n("ecosystem.card.label.source") + ": " + connectorName
            + "\n- " + i18n("ecosystem.card.label.scope") + ": "
            + text(plan, "scope", i18n("ecosystem.scope.link"))
            + "\n- " + i18n("ecosystem.card.label.target") + ": " + targetName
            + "\n- " + i18n("ecosystem.card.label.run.location") + ": " + runLocation
            + "\n- " + i18n("ecosystem.card.label.auth.type") + ": " + authType
            + (isBlank(sourceUrl) ? "" : "\n- " + i18n("ecosystem.card.label.link") + ": " + sourceUrl)
            + chatMissingActionText(plan));
        blocks.add(markdown);
        content.put("blocks", blocks);
        card.put("content", content);

        List<Map<String, Object>> buttons = new ArrayList<>();
        Map<String, Object> startButton = new LinkedHashMap<>();
        startButton.put("key", "start-collection");
        startButton.put("text", i18n("ecosystem.action.start"));
        startButton.put("type", "primary");
        startButton.put("disabled", !ready);
        Map<String, Object> startAction = new LinkedHashMap<>();
        startAction.put("type", "fetch");
        startAction.put("url", "/byaiService/ecosystemCollection/skill/start");
        startAction.put("method", "POST");
        startAction.put("body", Map.of("plan", plan));
        startAction.put("successExpression", "code=0");
        startAction.put("toast", Map.of("success", i18n("ecosystem.toast.start.success"),
            "fail", i18n("ecosystem.toast.start.failed")));
        startButton.put("action", startAction);
        buttons.add(startButton);
        buttons.add(linkButton(i18n("ecosystem.action.choose.knowledge.base"), knowledgeCenterLink(plan, true)));
        buttons.add(linkButton(i18n("ecosystem.action.configure"), knowledgeCenterLink(plan, false)));
        card.put("buttons", buttons);
        return card;
    }

    /**
     * 将计划中缺失的动作转换成用户可读的卡片提示。
     */
    private String chatMissingActionText(Map<String, Object> plan) {
        List<String> actions = stringList(plan.get("missingActions"));
        if (actions.isEmpty()) {
            return "";
        }
        List<String> texts = new ArrayList<>();
        for (String action : actions) {
            if ("LOCAL_AGENT".equals(action)) {
                texts.add(i18n("ecosystem.missing.local.agent"));
            }
            else if ("CONNECTION".equals(action)) {
                texts.add(i18n("ecosystem.missing.connection"));
            }
            else if ("DEFAULT_KNOWLEDGE_BASE".equals(action)) {
                texts.add(i18n("ecosystem.missing.default.knowledge.base"));
            }
            else if ("UNSUPPORTED_RUNTIME".equals(action)) {
                texts.add(i18n("ecosystem.missing.unsupported.runtime"));
            }
            else if ("SOURCE_URL".equals(action)) {
                texts.add(i18n("ecosystem.missing.source.url"));
            }
        }
        return texts.isEmpty() ? "" : "\n- " + i18n("ecosystem.card.label.pending") + ": "
            + String.join(i18n("ecosystem.list.separator"), texts);
    }

    /**
     * 构造聊天卡片中的链接按钮。
     */
    private Map<String, Object> linkButton(String text, String url) {
        Map<String, Object> button = new LinkedHashMap<>();
        button.put("text", text);
        Map<String, Object> action = new LinkedHashMap<>();
        action.put("type", "link");
        action.put("url", url);
        action.put("target", "_self");
        button.put("action", action);
        return button;
    }

    /**
     * 生成跳转知识中心生态采集抽屉的链接。
     */
    private String knowledgeCenterLink(Map<String, Object> plan, boolean chooseKnowledgeBase) {
        StringBuilder url = new StringBuilder("/knowledgeCenter?ecosystem=1&tab=personal");
        appendUrlParam(url, "source", text(plan, "connectorCode", ""));
        appendUrlParam(url, "sourceUrl", text(plan, "sourceUrl", ""));
        appendUrlParam(url, "scope", text(plan, "scope", ""));
        if (chooseKnowledgeBase) {
            appendUrlParam(url, "focus", "knowledgeBase");
        }
        return url.toString();
    }

    /**
     * 追加 URL 参数，并做 UTF-8 编码。
     */
    private void appendUrlParam(StringBuilder url, String key, String value) {
        if (isBlank(value)) {
            return;
        }
        url.append("&").append(key).append("=")
            .append(URLEncoder.encode(value, StandardCharsets.UTF_8));
    }

    /**
     * 兼容直接参数和 {plan: ...} 两种技能请求形态。
     */
    private Map<String, Object> chatPlanPayload(Map<String, Object> request) {
        if (request == null) {
            return Collections.emptyMap();
        }
        Object plan = request.get("plan");
        if (plan instanceof Map<?, ?> map) {
            return objectMap(map);
        }
        return new LinkedHashMap<>(request);
    }

    /**
     * 查找当前用户某连接器最适合复用的连接配置，优先 READY。
     */
    private Map<String, Object> findPreferredConnection(String connectorCode) {
        List<Map<String, Object>> connections = jdbcTemplate.query("""
            SELECT connection_id, connector_code, owner_type, auth_type, connection_name, run_location,
                   credential_config::text AS credential_config, runtime_config::text AS runtime_config,
                   site_sessions::text AS site_sessions, status, last_check_time, create_time
              FROM byai.bykc_ec_connection
             WHERE created_by = ? AND LOWER(connector_code) = LOWER(?)
             ORDER BY CASE WHEN status = 'READY' THEN 0 ELSE 1 END, update_time DESC, connection_id DESC
             LIMIT 1
            """, connectionRowMapper(), currentUserId(), connectorCode);
        return connections.isEmpty() ? Collections.emptyMap() : connections.get(0);
    }

    /**
     * 解析入库知识库目标；技能真正执行时可自动创建默认个人知识库。
     */
    private KnowledgeTarget resolveKnowledgeTarget(Map<String, Object> plan, boolean createIfMissing) {
        Long resourceId = firstNonNullLong(plan.get("knowledgeBaseResourceId"), plan.get("knowledgeBaseId"));
        String resourceName = stringValue(plan.get("knowledgeBaseName"));
        Long catalogId = longValue(plan.get("catalogId"));
        if (resourceId != null) {
            return new KnowledgeTarget(resourceId, defaultText(resourceName, i18n("ecosystem.default.knowledge.base")),
                catalogId);
        }
        List<KnowledgeTarget> targets = jdbcTemplate.query("""
            SELECT resource_id, resource_name, catalog_id
              FROM byai.ss_resource
             WHERE resource_biz_type = 'KG_DOC'
               AND owner_type = 'personal_default'
               AND create_by = ?
             ORDER BY resource_id ASC
             LIMIT 1
            """, (rs, rowNum) -> new KnowledgeTarget(
            rs.getLong("resource_id"),
            rs.getString("resource_name"),
            rs.getLong("catalog_id")), currentUserId());
        if (!targets.isEmpty()) {
            return targets.get(0);
        }
        if (!createIfMissing) {
            return new KnowledgeTarget(null, i18n("ecosystem.default.knowledge.base"), null);
        }
        SsResource dataset = datasetApplicationService.createDefaultPersonalDataset(currentUserId(), defaultUserCode(),
            defaultUserName());
        return new KnowledgeTarget(dataset.getResourceId(), dataset.getResourceName(), dataset.getCatalogId());
    }

    /**
     * 返回第一个可解析为 Long 的值。
     */
    private Long firstNonNullLong(Object... values) {
        for (Object value : values) {
            Long longValue = longValue(value);
            if (longValue != null) {
                return longValue;
            }
        }
        return null;
    }

    /**
     * 根据用户文本或链接推断连接器编码。
     */
    private String inferConnectorCode(String sourceUrl, String rawText) {
        String value = (defaultText(sourceUrl, "") + " " + defaultText(rawText, "")).toLowerCase(Locale.ROOT);
        if (value.contains("zhihu.com") || value.contains("知乎")) {
            return "zhihu";
        }
        if (value.contains("github.com") || value.contains("github")) {
            return "github";
        }
        if (value.contains("mail") || value.contains("邮箱")) {
            return "mail";
        }
        if (value.contains("dingtalk") || value.contains("钉钉")) {
            return "dingtalk";
        }
        return "web";
    }

    /**
     * 从用户自然语言中提取第一个 http/https 链接。
     */
    private String extractFirstUrl(String text) {
        if (isBlank(text)) {
            return "";
        }
        String[] parts = text.split("\\s+");
        for (String part : parts) {
            String value = part.trim();
            if (value.startsWith("http://") || value.startsWith("https://")) {
                return value.replaceAll("[，。,；;）)】\\]]+$", "");
            }
        }
        return "";
    }

    /**
     * 判断聊天/技能入口当前是否支持该连接器真实运行。
     */
    private boolean isRuntimeSupportedForChat(String connectorCode) {
        return "zhihu".equalsIgnoreCase(connectorCode) || "web".equalsIgnoreCase(connectorCode);
    }

    /**
     * 判断该连接器是否必须提供来源 URL。
     */
    private boolean requiresSourceUrl(String connectorCode) {
        return "zhihu".equalsIgnoreCase(connectorCode) || "web".equalsIgnoreCase(connectorCode);
    }

    /**
     * 判断该认证方式是否必须先保存连接配置。
     */
    private boolean requiresSavedConnection(String authType) {
        return "TOKEN".equalsIgnoreCase(authType) || "OAUTH".equalsIgnoreCase(authType)
            || "IMAP".equalsIgnoreCase(authType);
    }

    /**
     * 持久化一次运行的主记录、步骤、产物和信号。
     */
    private void saveRun(EcosystemRunVo run, EcosystemTaskVo task, String triggerType,
                         Map<String, Object> targetConfig) {
        jdbcTemplate.update("""
            INSERT INTO byai.bykc_ec_sync_run (
                run_id, task_id, trigger_type, status, current_step, total_count, markdown_count, asset_count,
                failed_count, need_action_type, need_action_payload, storage_path, started_at, finished_at, create_time
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSONB), ?, ?, ?, ?)
            """,
            run.getRunId(),
            run.getTaskId(),
            triggerType,
            run.getStatus(),
            run.getCurrentStep(),
            run.getTotalCount(),
            run.getMarkdownCount(),
            run.getAssetCount(),
            run.getFailedCount(),
            run.getNeedActionType(),
            toJson(needActionPayload(run)),
            run.getStoragePath(),
            run.getStartedAt(),
            run.getFinishedAt(),
            new Date());
        saveRunSteps(run);
        saveRunArtifacts(run, task, targetConfig);
        saveRunSignals(run);
    }

    /**
     * 持久化运行流水线步骤。
     */
    private void saveRunSteps(EcosystemRunVo run) {
        int order = 1;
        for (EcosystemRunVo.StepVo step : run.getSteps()) {
            jdbcTemplate.update("""
                INSERT INTO byai.bykc_ec_sync_run_step (
                    step_id, run_id, step_code, step_name, status, message, step_order,
                    started_at, finished_at, create_time
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                sequenceService.nextVal(),
                run.getRunId(),
                step.getStepCode(),
                step.getStepName(),
                step.getStatus(),
                step.getMessage(),
                order++,
                run.getStartedAt(),
                run.getFinishedAt(),
                new Date());
        }
    }

    /**
     * 持久化运行产物，并为每个产物生成入库记录。
     */
    private void saveRunArtifacts(EcosystemRunVo run, EcosystemTaskVo task, Map<String, Object> targetConfig) {
        for (EcosystemRunVo.ArtifactVo artifact : run.getArtifacts()) {
            Long artifactId = sequenceService.nextVal();
            jdbcTemplate.update("""
                INSERT INTO byai.bykc_ec_artifact (
                    artifact_id, run_id, artifact_type, artifact_name, source_url, title,
                    markdown_path, raw_path, asset_dir, manifest_path, item_count, file_id, file_url,
                    content_type, file_system_type, status, create_time
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                artifactId,
                run.getRunId(),
                artifact.getArtifactType(),
                artifact.getArtifactName(),
                defaultText(artifact.getSourceUrl(), task.getSourceUrl()),
                artifact.getArtifactName(),
                "MARKDOWN".equalsIgnoreCase(artifact.getArtifactType()) ? artifact.getStoragePath() : null,
                "RAW".equalsIgnoreCase(artifact.getArtifactType()) ? artifact.getStoragePath() : null,
                "ASSET".equalsIgnoreCase(artifact.getArtifactType()) ? artifact.getStoragePath() : null,
                "MANIFEST".equalsIgnoreCase(artifact.getArtifactType()) ? artifact.getStoragePath() : null,
                artifact.getItemCount(),
                artifact.getFileId(),
                artifact.getFileUrl(),
                artifact.getContentType(),
                artifact.getFileSystemType(),
                STATUS_SUCCESS,
                new Date());
            jdbcTemplate.update("""
                INSERT INTO byai.bykc_ec_import_record (
                    import_id, run_id, artifact_id, target_type, target_id, target_path, status, create_time
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                sequenceService.nextVal(),
                run.getRunId(),
                artifactId,
                task.getImportTarget(),
                resolveImportTargetId(task, targetConfig),
                artifact.getStoragePath(),
                STATUS_SUCCESS,
                new Date());
        }
    }

    /**
     * 解析入库目标 ID，优先使用知识库资源 ID。
     */
    private String resolveImportTargetId(EcosystemTaskVo task, Map<String, Object> targetConfig) {
        Object resourceId = targetConfig.get("knowledgeBaseResourceId");
        if (resourceId == null) {
            resourceId = targetConfig.get("knowledgeBaseId");
        }
        if (resourceId != null && !isBlank(String.valueOf(resourceId))) {
            return String.valueOf(resourceId);
        }
        if (task.getKnowledgeBaseResourceId() != null) {
            return String.valueOf(task.getKnowledgeBaseResourceId());
        }
        if (!isBlank(task.getKnowledgeBaseId())) {
            return task.getKnowledgeBaseId();
        }
        return task.getTargetName();
    }

    /**
     * 持久化运行级信号。当前信号挂在 run 维度，artifact_id 为空。
     */
    private void saveRunSignals(EcosystemRunVo run) {
        for (EcosystemSignalVo signal : run.getSignals()) {
            jdbcTemplate.update("""
                INSERT INTO byai.bykc_ec_artifact_signal (
                    signal_id, artifact_id, run_id, signal_type, signal_type_name, signal_code,
                    signal_name, confidence, signal_source, create_time
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                sequenceService.nextVal(),
                null,
                run.getRunId(),
                signal.getSignalType(),
                signal.getSignalTypeName(),
                signal.getSignalCode(),
                signal.getSignalName(),
                signal.getConfidence(),
                signal.getSource(),
                new Date());
        }
    }

    /**
     * 构造成功运行视图。
     */
    private EcosystemRunVo buildSuccessRun(Long runId,
                                           EcosystemTaskVo task,
                                           String triggerType,
                                           OpenCliRunner.CollectionResult collectionResult,
                                           EcosystemArtifactStorageService.StorageResult storageResult,
                                           EcosystemKnowledgeImportService.ImportResult importResult) {
        int markdownCount = collectionResult.getItems().size();
        int assetCount = collectionResult.getAssetCount();

        EcosystemRunVo run = new EcosystemRunVo();
        run.setRunId(runId);
        run.setTaskId(task.getTaskId());
        run.setStatus(STATUS_SUCCESS);
        run.setCurrentStep("BUILD_INDEX");
        run.setTotalCount(markdownCount);
        run.setMarkdownCount(markdownCount);
        run.setAssetCount(assetCount);
        run.setFailedCount(0);
        run.setStoragePath(storageResult.getStoragePath());
        run.setTargetName(task.getTargetName());
        run.setStartedAt(new Date());
        run.setFinishedAt(new Date());
        run.setSignals(task.getSignals());
        run.setSteps(buildSuccessSteps(task, triggerType, markdownCount, assetCount, importResult));
        run.setArtifacts(storageResult.getArtifacts());
        return run;
    }

    /**
     * 构造失败运行视图，并尽量保留已生成的产物信息。
     */
    private EcosystemRunVo buildFailedRun(Long runId,
                                          EcosystemTaskVo task,
                                          RuntimeException exception,
                                          OpenCliRunner.CollectionResult collectionResult,
                                          EcosystemArtifactStorageService.StorageResult storageResult) {
        EcosystemRunVo run = new EcosystemRunVo();
        run.setRunId(runId);
        run.setTaskId(task.getTaskId());
        run.setStatus(STATUS_FAILED);
        run.setCurrentStep(storageResult == null ? "CONNECT_SOURCE" : "IMPORT_KNOWLEDGE");
        run.setTotalCount(collectionResult == null ? 0 : collectionResult.getItems().size());
        run.setMarkdownCount(collectionResult == null ? 0 : collectionResult.getItems().size());
        run.setAssetCount(collectionResult == null ? 0 : collectionResult.getAssetCount());
        run.setFailedCount(1);
        run.setNeedActionType(resolveNeedActionType(exception));
        run.setNeedActionMessage(resolveNeedActionMessage(exception));
        run.setStoragePath(storageResult == null ? "ecosystem/users/" + currentUserId() + "/runs/" + runId + "/"
            : storageResult.getStoragePath());
        run.setTargetName(task.getTargetName());
        run.setStartedAt(new Date());
        run.setFinishedAt(new Date());
        run.setSignals(task.getSignals());
        run.setSteps(buildFailedSteps(task, exception, storageResult != null));
        run.setArtifacts(storageResult == null ? Collections.emptyList() : storageResult.getArtifacts());
        return run;
    }

    /**
     * 构造成功场景下的流水线步骤。
     */
    private List<EcosystemRunVo.StepVo> buildSuccessSteps(EcosystemTaskVo task, String triggerType, int markdownCount,
                                                          int assetCount,
                                                          EcosystemKnowledgeImportService.ImportResult importResult) {
        List<EcosystemRunVo.StepVo> steps = new ArrayList<>();
        steps.add(new EcosystemRunVo.StepVo("CONNECT_SOURCE", i18n("ecosystem.step.connect.source"), STATUS_SUCCESS,
            i18n("ecosystem.status.success"), i18n("ecosystem.step.message.connected", task.getSourceName(),
            triggerType)));
        steps.add(new EcosystemRunVo.StepVo("PULL_RAW", i18n("ecosystem.step.pull.raw"), STATUS_SUCCESS,
            i18n("ecosystem.status.success"), i18n("ecosystem.step.message.pulled.raw", markdownCount)));
        steps.add(new EcosystemRunVo.StepVo("NORMALIZE_MARKDOWN", i18n("ecosystem.step.normalize.markdown"),
            STATUS_SUCCESS, i18n("ecosystem.status.success"),
            i18n("ecosystem.step.message.normalized.markdown", markdownCount)));
        steps.add(new EcosystemRunVo.StepVo("DOWNLOAD_ASSETS", i18n("ecosystem.step.download.assets"),
            assetCount > 0 ? STATUS_SUCCESS : STATUS_SKIPPED,
            assetCount > 0 ? i18n("ecosystem.status.success") : i18n("ecosystem.status.skipped"),
            assetCount > 0 ? i18n("ecosystem.step.message.assets.archived", assetCount)
                : i18n("ecosystem.step.message.assets.empty")));
        steps.add(new EcosystemRunVo.StepVo("SIGNAL_TAGGING", i18n("ecosystem.step.signal.tagging"), STATUS_SUCCESS,
            i18n("ecosystem.status.success"), i18n("ecosystem.step.message.signals.tagged")));
        steps.add(new EcosystemRunVo.StepVo("IMPORT_KNOWLEDGE", i18n("ecosystem.step.import.knowledge"),
            STATUS_SUCCESS, i18n("ecosystem.status.success"), importResult.getMessage()));
        steps.add(new EcosystemRunVo.StepVo("BUILD_INDEX", i18n("ecosystem.step.build.index"), STATUS_SUCCESS,
            i18n("ecosystem.status.success"), i18n("ecosystem.step.message.index.triggered")));
        return steps;
    }

    /**
     * 构造失败场景下的流水线步骤，根据产物是否已落地决定失败点。
     */
    private List<EcosystemRunVo.StepVo> buildFailedSteps(EcosystemTaskVo task, RuntimeException exception,
                                                         boolean artifactsStored) {
        List<EcosystemRunVo.StepVo> steps = new ArrayList<>();
        steps.add(new EcosystemRunVo.StepVo("CONNECT_SOURCE", i18n("ecosystem.step.connect.source"),
            artifactsStored ? STATUS_SUCCESS : STATUS_FAILED,
            artifactsStored ? i18n("ecosystem.status.success") : i18n("ecosystem.status.failed"),
            artifactsStored ? i18n("ecosystem.step.message.source.connected") : resolveNeedActionMessage(exception)));
        steps.add(new EcosystemRunVo.StepVo("PULL_RAW", i18n("ecosystem.step.pull.raw"),
            artifactsStored ? STATUS_SUCCESS : STATUS_CREATED,
            artifactsStored ? i18n("ecosystem.status.success") : i18n("ecosystem.status.pending"),
            artifactsStored ? i18n("ecosystem.step.message.raw.pulled")
                : i18n("ecosystem.step.message.wait.source")));
        steps.add(new EcosystemRunVo.StepVo("NORMALIZE_MARKDOWN", i18n("ecosystem.step.normalize.markdown"),
            artifactsStored ? STATUS_SUCCESS : STATUS_CREATED,
            artifactsStored ? i18n("ecosystem.status.success") : i18n("ecosystem.status.pending"),
            artifactsStored ? i18n("ecosystem.step.message.markdown.converted")
                : i18n("ecosystem.step.message.wait.raw")));
        steps.add(new EcosystemRunVo.StepVo("DOWNLOAD_ASSETS", i18n("ecosystem.step.download.assets"),
            artifactsStored ? STATUS_SUCCESS : STATUS_CREATED,
            artifactsStored ? i18n("ecosystem.status.success") : i18n("ecosystem.status.pending"),
            artifactsStored ? i18n("ecosystem.step.message.assets.done")
                : i18n("ecosystem.step.message.wait.markdown")));
        steps.add(new EcosystemRunVo.StepVo("SIGNAL_TAGGING", i18n("ecosystem.step.signal.tagging"),
            artifactsStored ? STATUS_SUCCESS : STATUS_CREATED,
            artifactsStored ? i18n("ecosystem.status.success") : i18n("ecosystem.status.pending"),
            artifactsStored ? i18n("ecosystem.step.message.signals.done")
                : i18n("ecosystem.step.message.wait.artifacts")));
        steps.add(new EcosystemRunVo.StepVo("IMPORT_KNOWLEDGE", i18n("ecosystem.step.import.knowledge"),
            artifactsStored ? STATUS_FAILED : STATUS_CREATED,
            artifactsStored ? i18n("ecosystem.status.failed") : i18n("ecosystem.status.pending"),
            artifactsStored ? resolveNeedActionMessage(exception) : i18n("ecosystem.step.message.wait.collection")));
        steps.add(new EcosystemRunVo.StepVo("BUILD_INDEX", i18n("ecosystem.step.build.index"), STATUS_CREATED,
            i18n("ecosystem.status.pending"), i18n("ecosystem.step.message.wait.import")));
        return steps;
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

    /**
     * 查询运行步骤明细。
     */
    private List<EcosystemRunVo.StepVo> listRunSteps(Long runId) {
        return jdbcTemplate.query("""
            SELECT step_code, step_name, status, message
              FROM byai.bykc_ec_sync_run_step
             WHERE run_id = ?
             ORDER BY step_order
            """, (rs, rowNum) -> new EcosystemRunVo.StepVo(
            rs.getString("step_code"),
            rs.getString("step_name"),
            rs.getString("status"),
            statusName(rs.getString("status")),
            rs.getString("message")), runId);
    }

    /**
     * 查询运行产物明细。
     */
    private List<EcosystemRunVo.ArtifactVo> listRunArtifacts(Long runId) {
        return jdbcTemplate.query("""
            SELECT artifact_type, artifact_name, markdown_path, raw_path, asset_dir, manifest_path, item_count,
                   file_id, file_url, content_type, file_system_type, source_url
              FROM byai.bykc_ec_artifact
             WHERE run_id = ?
             ORDER BY artifact_id
            """, (rs, rowNum) -> {
            EcosystemRunVo.ArtifactVo artifact = new EcosystemRunVo.ArtifactVo(
                rs.getString("artifact_type"),
                rs.getString("artifact_name"),
                artifactStoragePath(rs),
                rs.getInt("item_count"));
            Long fileId = rs.getLong("file_id");
            artifact.setFileId(rs.wasNull() ? null : fileId);
            artifact.setFileUrl(rs.getString("file_url"));
            artifact.setContentType(rs.getString("content_type"));
            artifact.setFileSystemType(rs.getString("file_system_type"));
            artifact.setSourceUrl(rs.getString("source_url"));
            return artifact;
        }, runId);
    }

    /**
     * 查询运行信号明细。
     */
    private List<EcosystemSignalVo> listRunSignals(Long runId) {
        return jdbcTemplate.query("""
            SELECT signal_type, signal_type_name, signal_code, signal_name, confidence, signal_source
              FROM byai.bykc_ec_artifact_signal
             WHERE run_id = ?
             ORDER BY signal_type, signal_code
            """, signalRowMapper(), runId);
    }

    /**
     * 按当前用户查询任务。
     */
    private EcosystemTaskVo findTask(Long taskId) {
        return findTask(taskId, currentUserId());
    }

    /**
     * 按指定用户查询任务，用于定时调度以任务创建人身份运行。
     */
    private EcosystemTaskVo findTask(Long taskId, Long userId) {
        List<EcosystemTaskVo> tasks = jdbcTemplate.query("""
            SELECT t.task_id, t.task_name, t.connector_code, c.connector_name, t.owner_type, t.run_location,
                   t.connection_id, cn.connection_name, cn.status AS connection_status, cn.auth_type,
                   cn.last_check_time, t.source_url, t.scope_config::text AS scope_config, t.target_type,
                   t.target_config::text AS target_config, t.signal_config::text AS signal_config,
                   t.schedule_type, t.schedule_config::text AS schedule_config, t.next_run_time,
                   t.last_scheduled_run_time, t.status, t.create_time,
                   r.run_id AS last_run_id, r.status AS last_run_status,
                   COALESCE(r.finished_at, r.started_at, r.create_time) AS last_run_time,
                   r.markdown_count AS last_markdown_count, r.failed_count AS last_failed_count
              FROM byai.bykc_ec_sync_task t
              LEFT JOIN byai.bykc_ec_connector c ON c.connector_code = t.connector_code
              LEFT JOIN byai.bykc_ec_connection cn ON cn.connection_id = t.connection_id
              LEFT JOIN LATERAL (
                    SELECT run_id, status, started_at, finished_at, create_time, markdown_count, failed_count
                      FROM byai.bykc_ec_sync_run
                     WHERE task_id = t.task_id
                     ORDER BY create_time DESC, run_id DESC
                     LIMIT 1
              ) r ON TRUE
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
    private Map<String, Object> findTaskTargetConfig(Long taskId) {
        return findTaskTargetConfig(taskId, currentUserId());
    }

    /**
     * 按指定用户查询任务入库目标配置。
     */
    private Map<String, Object> findTaskTargetConfig(Long taskId, Long userId) {
        List<String> configs = jdbcTemplate.query("""
            SELECT target_config::text
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
    private Map<String, Object> findTaskScheduleConfig(Long taskId, Long userId) {
        List<String> configs = jdbcTemplate.query("""
            SELECT schedule_config::text
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
    private List<ScheduledTaskRef> listDueScheduledTasks() {
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
    private boolean lockScheduledTask(ScheduledTaskRef taskRef) {
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
    private void markScheduledRunFailure(ScheduledTaskRef taskRef, RuntimeException exception) {
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
    private Long findRunTaskId(Long runId) {
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
    private void runAsUser(Long userId, Runnable runnable) {
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
     * 新增或更新当前用户本机采集端心跳。
     */
    private void upsertAgentHeartbeat(EcosystemAgentHeartbeatRequest request) {
        List<Long> agentIds = jdbcTemplate.query("""
            SELECT agent_id
              FROM byai.bykc_ec_collector_agent
             WHERE user_id = ?
             ORDER BY update_time DESC, agent_id DESC
             LIMIT 1
            """, (rs, rowNum) -> rs.getLong("agent_id"), currentUserId());
        Date now = new Date();
        String siteSessions = toJson(defaultSiteSessions(request.getSiteSessions()));
        if (agentIds.isEmpty()) {
            jdbcTemplate.update("""
                INSERT INTO byai.bykc_ec_collector_agent (
                    agent_id, user_id, user_code, agent_name, runtime_name, runtime_version,
                    browser_bridge_status, chrome_profile, site_sessions, status,
                    last_heartbeat_time, create_time, update_time
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSONB), ?, ?, ?, ?)
                """,
                sequenceService.nextVal(),
                currentUserId(),
                defaultUserCode(),
                defaultText(request.getAgentName(), i18n("ecosystem.local.agent.name", defaultUserName())),
                defaultText(request.getRuntimeName(), "OpenCLI"),
                defaultText(request.getRuntimeVersion(), "-"),
                defaultText(request.getBrowserBridgeStatus(), "UNKNOWN"),
                defaultText(request.getChromeProfile(), "bykc-local"),
                siteSessions,
                defaultText(request.getStatus(), "ONLINE"),
                now,
                now,
                now);
            return;
        }
        jdbcTemplate.update("""
            UPDATE byai.bykc_ec_collector_agent
               SET agent_name = ?, runtime_name = ?, runtime_version = ?, browser_bridge_status = ?,
                   chrome_profile = ?, site_sessions = CAST(? AS JSONB), status = ?,
                   last_heartbeat_time = ?, update_time = ?
             WHERE agent_id = ?
            """,
            defaultText(request.getAgentName(), i18n("ecosystem.local.agent.name", defaultUserName())),
            defaultText(request.getRuntimeName(), "OpenCLI"),
            defaultText(request.getRuntimeVersion(), "-"),
            defaultText(request.getBrowserBridgeStatus(), "UNKNOWN"),
            defaultText(request.getChromeProfile(), "bykc-local"),
            siteSessions,
            defaultText(request.getStatus(), "ONLINE"),
            now,
            now,
                agentIds.get(0));
    }

    /**
     * 查询启用的连接器配置。
     */
    private EcosystemConnectorVo findConnector(String connectorCode) {
        List<EcosystemConnectorVo> connectors = jdbcTemplate.query("""
            SELECT connector_code, connector_name, category, run_locations::text AS run_locations,
                   auth_types::text AS auth_types, capability_schema::text AS capability_schema,
                   runtime_type, status, description
              FROM byai.bykc_ec_connector
             WHERE LOWER(connector_code) = LOWER(?) AND status = 'ENABLED'
            """, connectorRowMapper(), defaultText(connectorCode, ""));
        if (connectors.isEmpty()) {
            throw new IllegalArgumentException(i18n("ecosystem.error.connector.unsupported", connectorCode));
        }
        return connectors.get(0);
    }

    /**
     * 校验连接配置归属当前用户且属于指定连接器。
     */
    private void ensureConnectionOwned(Long connectionId, String connectorCode) {
        List<Long> ids = jdbcTemplate.query("""
            SELECT connection_id
              FROM byai.bykc_ec_connection
             WHERE connection_id = ? AND created_by = ? AND LOWER(connector_code) = LOWER(?)
            """, (rs, rowNum) -> rs.getLong("connection_id"), connectionId, currentUserId(), connectorCode);
        if (ids.isEmpty()) {
            throw new IllegalArgumentException(i18n("ecosystem.error.connection.available.not.found"));
        }
    }

    /**
     * 查询单个连接配置的安全视图。
     */
    private Map<String, Object> findConnectionView(Long connectionId) {
        List<Map<String, Object>> connections = jdbcTemplate.query("""
            SELECT connection_id, connector_code, owner_type, auth_type, connection_name, run_location,
                   credential_config::text AS credential_config, runtime_config::text AS runtime_config,
                   site_sessions::text AS site_sessions, status, last_check_time, create_time
              FROM byai.bykc_ec_connection
             WHERE connection_id = ? AND created_by = ?
            """, connectionRowMapper(), connectionId, currentUserId());
        if (connections.isEmpty()) {
            throw new IllegalArgumentException(i18n("ecosystem.error.connection.not.found"));
        }
        return connections.get(0);
    }

    /**
     * 查询连接凭据配置，内部使用，返回值可能包含敏感字段。
     */
    private Map<String, Object> findCredentialConfig(Long connectionId) {
        if (connectionId == null) {
            return Collections.emptyMap();
        }
        List<String> configs = jdbcTemplate.query("""
            SELECT credential_config::text
              FROM byai.bykc_ec_connection
             WHERE connection_id = ? AND created_by = ?
            """, (rs, rowNum) -> rs.getString(1), connectionId, currentUserId());
        if (configs.isEmpty()) {
            return Collections.emptyMap();
        }
        return fromJson(configs.get(0), MAP_TYPE, Collections.emptyMap());
    }

    /**
     * 合并连接凭据配置，Token 写入时同时保存脱敏尾号和配置标记。
     */
    private Map<String, Object> buildCredentialConfig(Long connectionId, Map<String, Object> request) {
        Map<String, Object> config = new LinkedHashMap<>(findCredentialConfig(connectionId));
        String token = stringValue(request.get("token"));
        if (!isBlank(token)) {
            config.put("token", token.trim());
            config.put("tokenLast4", last4(token));
            config.put("tokenConfigured", true);
        }
        putIfPresent(config, "account", stringValue(request.get("account")));
        putIfPresent(config, "imapHost", stringValue(request.get("imapHost")));
        putIfPresent(config, "oauthProvider", stringValue(request.get("oauthProvider")));
        return config;
    }

    /**
     * 构造运行时配置，例如 Chrome Profile、OpenCLI Profile 和服务端地址。
     */
    private Map<String, Object> buildRuntimeConfig(Map<String, Object> request) {
        Map<String, Object> config = new LinkedHashMap<>();
        putIfPresent(config, "chromeProfile", stringValue(request.get("chromeProfile")));
        putIfPresent(config, "openCliProfile", stringValue(request.get("openCliProfile")));
        putIfPresent(config, "serverEndpoint", stringValue(request.get("serverEndpoint")));
        return config;
    }

    /**
     * 根据认证方式和凭据完整度计算连接状态。
     */
    private String resolveConnectionStatus(String authType, Map<String, Object> credentialConfig) {
        if ("TOKEN".equalsIgnoreCase(authType) || "OAUTH".equalsIgnoreCase(authType)
            || "IMAP".equalsIgnoreCase(authType)) {
            return credentialConfig.containsKey("token") || Boolean.TRUE.equals(credentialConfig.get("tokenConfigured"))
                ? "READY" : "NEED_AUTH";
        }
        if ("BROWSER".equalsIgnoreCase(authType)) {
            return "NEED_AUTH";
        }
        return "READY";
    }

    /**
     * 构造对外返回的安全凭据视图，不返回明文 Token。
     */
    private Map<String, Object> safeCredentialConfig(Map<String, Object> credentialConfig) {
        Map<String, Object> safeConfig = new LinkedHashMap<>();
        boolean hasToken = credentialConfig.containsKey("token")
            || Boolean.TRUE.equals(credentialConfig.get("tokenConfigured"));
        safeConfig.put("hasToken", hasToken);
        putIfPresent(safeConfig, "tokenLast4", stringValue(credentialConfig.get("tokenLast4")));
        putIfPresent(safeConfig, "account", stringValue(credentialConfig.get("account")));
        putIfPresent(safeConfig, "imapHost", stringValue(credentialConfig.get("imapHost")));
        putIfPresent(safeConfig, "oauthProvider", stringValue(credentialConfig.get("oauthProvider")));
        return safeConfig;
    }

    /**
     * 连接器表行映射。
     */
    private RowMapper<EcosystemConnectorVo> connectorRowMapper() {
        return (rs, rowNum) -> {
            List<String> runLocations = fromJson(rs.getString("run_locations"), STRING_LIST_TYPE, Collections.emptyList());
            List<String> authTypes = fromJson(rs.getString("auth_types"), STRING_LIST_TYPE, Collections.emptyList());
            Map<String, Object> capabilitySchema = fromJson(rs.getString("capability_schema"), MAP_TYPE,
                Collections.emptyMap());
            EcosystemConnectorVo connector = new EcosystemConnectorVo();
            connector.setConnectorCode(rs.getString("connector_code"));
            connector.setConnectorName(rs.getString("connector_name"));
            connector.setCategory(rs.getString("category"));
            connector.setAvailable("ENABLED".equalsIgnoreCase(rs.getString("status")));
            connector.setRequiresLocalAgent(containsIgnoreCase(runLocations, "LOCAL"));
            connector.setRunLocations(runLocations);
            connector.setAuthTypes(authTypes);
            connector.setCapabilities(capabilities(capabilitySchema));
            connector.setRuntimeType(rs.getString("runtime_type"));
            connector.setStatus(rs.getString("status"));
            connector.setDescription(rs.getString("description"));
            return connector;
        };
    }

    /**
     * 本机采集端状态表行映射。
     */
    private RowMapper<EcosystemAgentStatusVo> agentStatusRowMapper() {
        return (rs, rowNum) -> {
            EcosystemAgentStatusVo status = new EcosystemAgentStatusVo();
            String agentStatus = rs.getString("status");
            status.setConnected("ONLINE".equalsIgnoreCase(agentStatus));
            status.setAgentName(rs.getString("agent_name"));
            status.setRuntimeName(rs.getString("runtime_name"));
            status.setRuntimeVersion(rs.getString("runtime_version"));
            status.setBrowserBridgeStatus(rs.getString("browser_bridge_status"));
            status.setChromeProfile(rs.getString("chrome_profile"));
            status.setLastHeartbeatTime(toDate(rs.getTimestamp("last_heartbeat_time")));
            status.setSiteSessions(fromJson(rs.getString("site_sessions"), SITE_SESSION_LIST_TYPE,
                Collections.emptyList()));
            return status;
        };
    }

    /**
     * 采集任务表行映射，包含最近一次运行摘要。
     */
    private RowMapper<EcosystemTaskVo> taskRowMapper() {
        return (rs, rowNum) -> {
            Map<String, Object> scopeConfig = fromJson(rs.getString("scope_config"), MAP_TYPE, Collections.emptyMap());
            Map<String, Object> targetConfig = fromJson(rs.getString("target_config"), MAP_TYPE, Collections.emptyMap());
            EcosystemTaskVo task = new EcosystemTaskVo();
            task.setTaskId(rs.getLong("task_id"));
            task.setTaskName(rs.getString("task_name"));
            task.setConnectorCode(rs.getString("connector_code"));
            Long connectionId = rs.getLong("connection_id");
            task.setConnectionId(rs.wasNull() ? null : connectionId);
            task.setConnectionName(rs.getString("connection_name"));
            task.setConnectionStatus(rs.getString("connection_status"));
            task.setAuthType(rs.getString("auth_type"));
            task.setLastCheckTime(toDate(rs.getTimestamp("last_check_time")));
            task.setSourceName(defaultText(rs.getString("connector_name"), rs.getString("connector_code")));
            task.setSourceUrl(defaultText(rs.getString("source_url"), text(scopeConfig, "sourceUrl", "-")));
            task.setScope(text(scopeConfig, "scope", i18n("ecosystem.scope.recent")));
            task.setOwnerType(rs.getString("owner_type"));
            task.setRunLocation(rs.getString("run_location"));
            task.setScheduleType(rs.getString("schedule_type"));
            task.setScheduleTypeName(scheduleTypeName(task.getScheduleType()));
            task.setScheduleConfig(fromJson(rs.getString("schedule_config"), MAP_TYPE, Collections.emptyMap()));
            task.setNextRunTime(toDate(rs.getTimestamp("next_run_time")));
            task.setLastScheduledRunTime(toDate(rs.getTimestamp("last_scheduled_run_time")));
            task.setImportTarget(rs.getString("target_type"));
            task.setTargetName(text(targetConfig, "targetName", rs.getString("target_type")));
            task.setCatalogId(longValue(targetConfig.get("catalogId")));
            task.setKnowledgeBaseId(stringValue(targetConfig.get("knowledgeBaseId")));
            task.setKnowledgeBaseResourceId(longValue(targetConfig.get("knowledgeBaseResourceId")));
            task.setKnowledgeBaseName(stringValue(targetConfig.get("knowledgeBaseName")));
            task.setStatus(rs.getString("status"));
            task.setCreateTime(toDate(rs.getTimestamp("create_time")));
            Long lastRunId = rs.getLong("last_run_id");
            task.setLastRunId(rs.wasNull() ? null : lastRunId);
            String lastRunStatus = rs.getString("last_run_status");
            task.setLastRunStatus(lastRunStatus);
            task.setLastRunStatusName(statusName(lastRunStatus));
            task.setLastRunTime(toDate(rs.getTimestamp("last_run_time")));
            Integer lastMarkdownCount = rs.getInt("last_markdown_count");
            task.setLastMarkdownCount(rs.wasNull() ? null : lastMarkdownCount);
            Integer lastFailedCount = rs.getInt("last_failed_count");
            task.setLastFailedCount(rs.wasNull() ? null : lastFailedCount);
            task.setSignals(fromJson(rs.getString("signal_config"), SIGNAL_LIST_TYPE, Collections.emptyList()));
            return task;
        };
    }

    /**
     * 连接配置表行映射，返回安全视图。
     */
    private RowMapper<Map<String, Object>> connectionRowMapper() {
        return (rs, rowNum) -> {
            Map<String, Object> credentialConfig = fromJson(rs.getString("credential_config"), MAP_TYPE,
                Collections.emptyMap());
            Map<String, Object> runtimeConfig = fromJson(rs.getString("runtime_config"), MAP_TYPE,
                Collections.emptyMap());
            Map<String, Object> connection = new LinkedHashMap<>();
            connection.put("connectionId", String.valueOf(rs.getLong("connection_id")));
            connection.put("connectorCode", rs.getString("connector_code"));
            connection.put("ownerType", rs.getString("owner_type"));
            connection.put("authType", rs.getString("auth_type"));
            connection.put("authTypeName", authTypeName(rs.getString("auth_type")));
            connection.put("connectionName", rs.getString("connection_name"));
            connection.put("runLocation", rs.getString("run_location"));
            connection.put("runLocationName", runLocationName(rs.getString("run_location")));
            connection.put("credentialConfig", safeCredentialConfig(credentialConfig));
            connection.put("runtimeConfig", runtimeConfig);
            connection.put("siteSessions", fromJson(rs.getString("site_sessions"), MAP_LIST_TYPE,
                Collections.emptyList()));
            connection.put("status", rs.getString("status"));
            connection.put("statusName", connectionStatusName(rs.getString("status")));
            connection.put("lastCheckTime", toDate(rs.getTimestamp("last_check_time")));
            connection.put("createTime", toDate(rs.getTimestamp("create_time")));
            return connection;
        };
    }

    /**
     * 采集运行表行映射。
     */
    private RowMapper<EcosystemRunVo> runRowMapper() {
        return (rs, rowNum) -> {
            Map<String, Object> targetConfig = fromJson(rs.getString("target_config"), MAP_TYPE, Collections.emptyMap());
            Map<String, Object> needActionPayload = fromJson(rs.getString("need_action_payload"), MAP_TYPE,
                Collections.emptyMap());
            EcosystemRunVo run = new EcosystemRunVo();
            run.setRunId(rs.getLong("run_id"));
            run.setTaskId(rs.getLong("task_id"));
            run.setStatus(rs.getString("status"));
            run.setCurrentStep(rs.getString("current_step"));
            run.setTotalCount(rs.getInt("total_count"));
            run.setMarkdownCount(rs.getInt("markdown_count"));
            run.setAssetCount(rs.getInt("asset_count"));
            run.setFailedCount(rs.getInt("failed_count"));
            run.setNeedActionType(rs.getString("need_action_type"));
            run.setNeedActionMessage(text(needActionPayload, "message", null));
            run.setNeedActionStatus(text(needActionPayload, "actionStatus", null));
            run.setStoragePath(rs.getString("storage_path"));
            run.setTargetName(text(targetConfig, "targetName", ""));
            run.setStartedAt(toDate(rs.getTimestamp("started_at")));
            run.setFinishedAt(toDate(rs.getTimestamp("finished_at")));
            return run;
        };
    }

    /**
     * 分层信号表行映射。
     */
    private RowMapper<EcosystemSignalVo> signalRowMapper() {
        return (rs, rowNum) -> {
            BigDecimal confidence = rs.getBigDecimal("confidence");
            return new EcosystemSignalVo(
                rs.getString("signal_type"),
                rs.getString("signal_type_name"),
                rs.getString("signal_code"),
                rs.getString("signal_name"),
                confidence == null ? null : confidence.doubleValue(),
                rs.getString("signal_source"));
        };
    }

    /**
     * 构造未连接本机采集端时的默认离线状态。
     */
    private EcosystemAgentStatusVo offlineAgentStatus() {
        EcosystemAgentStatusVo status = new EcosystemAgentStatusVo();
        status.setConnected(Boolean.FALSE);
        status.setAgentName(i18n("ecosystem.local.agent.name", defaultUserName()));
        status.setRuntimeName("OpenCLI");
        status.setRuntimeVersion("-");
        status.setBrowserBridgeStatus(i18n("ecosystem.local.agent.disconnected"));
        status.setChromeProfile("-");
        status.setSiteSessions(Collections.emptyList());
        return status;
    }

    /**
     * 构造任务采集范围配置，写入 bykc_ec_sync_task.scope_config。
     */
    private Map<String, Object> buildScopeConfig(EcosystemTaskCreateRequest request, EcosystemTaskVo task) {
        Map<String, Object> config = new LinkedHashMap<>();
        config.put("scope", task.getScope());
        config.put("sourceUrl", task.getSourceUrl());
        putIfPresent(config, "project", request.getProject());
        putIfPresent(config, "product", request.getProduct());
        putIfPresent(config, "customer", request.getCustomer());
        putIfPresent(config, "domain", request.getDomain());
        if (request.getSignalTags() != null) {
            config.put("signalTags", request.getSignalTags());
        }
        return config;
    }

    /**
     * 构造任务入库目标配置，写入 bykc_ec_sync_task.target_config。
     */
    private Map<String, Object> buildTargetConfig(EcosystemTaskCreateRequest request, EcosystemTaskVo task) {
        Map<String, Object> config = new LinkedHashMap<>();
        config.put("targetName", task.getTargetName());
        config.put("importTarget", task.getImportTarget());
        config.put("catalogId", request.getCatalogId());
        config.put("knowledgeBaseId", request.getKnowledgeBaseId());
        config.put("knowledgeBaseResourceId", request.getKnowledgeBaseResourceId());
        config.put("knowledgeBaseName", request.getKnowledgeBaseName());
        return config;
    }

    /**
     * 构造任务调度配置，并计算下一次运行时间。
     */
    private Map<String, Object> buildScheduleConfig(EcosystemTaskCreateRequest request, String scheduleType) {
        Map<String, Object> config = new LinkedHashMap<>(defaultMap(request.getScheduleConfig()));
        config.put("scheduleType", scheduleType);
        if ("daily".equalsIgnoreCase(scheduleType) || "weekly".equalsIgnoreCase(scheduleType)) {
            config.put("hour", intValue(config.get("hour"), 9));
            config.put("timezone", defaultText(stringValue(config.get("timezone")), "Asia/Shanghai"));
        }
        if ("weekly".equalsIgnoreCase(scheduleType)) {
            config.put("dayOfWeek", dayOfWeekValue(config.get("dayOfWeek")).name());
        }
        Date nextRunTime = resolveNextRunTime(scheduleType, config, new Date());
        return withNextRunTime(config, nextRunTime);
    }

    /**
     * 将 nextRunTime 同步写入调度 JSON 配置。
     */
    private Map<String, Object> withNextRunTime(Map<String, Object> scheduleConfig, Date nextRunTime) {
        Map<String, Object> config = new LinkedHashMap<>(defaultMap(scheduleConfig));
        if (nextRunTime == null) {
            config.remove("nextRunTime");
            return config;
        }
        config.put("nextRunTime", nextRunTime.toInstant().toString());
        return config;
    }

    /**
     * 根据 daily/weekly 调度配置计算下一次运行时间。
     */
    private Date resolveNextRunTime(String scheduleType, Map<String, Object> scheduleConfig, Date baseTime) {
        if (!"daily".equalsIgnoreCase(scheduleType) && !"weekly".equalsIgnoreCase(scheduleType)) {
            return null;
        }
        ZoneId zoneId = ZoneId.of(defaultText(stringValue(scheduleConfig.get("timezone")), "Asia/Shanghai"));
        ZonedDateTime base = ZonedDateTime.ofInstant(baseTime.toInstant(), zoneId);
        int hour = Math.max(0, Math.min(23, intValue(scheduleConfig.get("hour"), 9)));
        ZonedDateTime next = base.withHour(hour).withMinute(0).withSecond(0).withNano(0);
        if ("weekly".equalsIgnoreCase(scheduleType)) {
            DayOfWeek targetDay = dayOfWeekValue(scheduleConfig.get("dayOfWeek"));
            int daysToAdd = (targetDay.getValue() - base.getDayOfWeek().getValue() + 7) % 7;
            next = next.plusDays(daysToAdd);
        }
        if (!next.isAfter(base)) {
            next = next.plusDays("weekly".equalsIgnoreCase(scheduleType) ? 7 : 1);
        }
        return Date.from(next.toInstant());
    }

    /**
     * 写入业务对象信号，例如项目、产品、客户、领域。
     */
    private void putObjectSignal(Map<String, EcosystemSignalVo> signals, String code, String typeName, String value) {
        if (isBlank(value)) {
            return;
        }
        putSignal(signals, "object", i18n("ecosystem.signal.type.object"), code,
            i18n("ecosystem.signal.name.object", typeName, value.trim()), 0.9, "user");
    }

    /**
     * 写入信号 Map，同类型同编码自动去重。
     */
    private void putSignal(Map<String, EcosystemSignalVo> signals, String type, String typeName, String code,
                           String name, double confidence, String source) {
        signals.put(type + ":" + code, new EcosystemSignalVo(type, typeName, code, name, confidence, source));
    }

    /**
     * 根据采集范围文本推断内容类型信号。
     */
    private String resolveContentSignal(String scope) {
        if (scope.contains("SOP") || scope.contains("流程")) {
            return "SOP";
        }
        if (scope.contains("纪要") || scope.contains("会议")) {
            return i18n("ecosystem.content.meeting.minutes");
        }
        if (scope.contains("需求")) {
            return i18n("ecosystem.content.requirement");
        }
        if (scope.contains("方案")) {
            return i18n("ecosystem.content.solution");
        }
        return i18n("ecosystem.content.collected.material");
    }

    /**
     * 根据归属类型推断隐私信号编码。
     */
    private String resolvePrivacyCode(EcosystemTaskCreateRequest request) {
        return "enterprise".equalsIgnoreCase(request.getOwnerType()) ? "enterprise_candidate" : "personal";
    }

    /**
     * 根据归属类型推断隐私信号名称。
     */
    private String resolvePrivacyName(EcosystemTaskCreateRequest request) {
        return "enterprise".equalsIgnoreCase(request.getOwnerType()) ? i18n("ecosystem.privacy.enterprise.candidate")
            : i18n("ecosystem.privacy.personal");
    }

    /**
     * 解析入库目标展示名称。
     */
    private String resolveTargetName(EcosystemTaskCreateRequest request) {
        String knowledgeBase = defaultText(request.getKnowledgeBaseName(),
            defaultText(request.getKnowledgeBaseId(), i18n("ecosystem.default.knowledge.base")));
        return i18n("ecosystem.target.personal.knowledge.base", knowledgeBase);
    }

    /**
     * 校验任务创建请求。
     */
    private void validateTaskCreateRequest(EcosystemTaskCreateRequest request) {
        if (request == null) {
            throw new IllegalArgumentException(i18n("ecosystem.error.task.empty"));
        }
        if (isBlank(request.getConnectorCode())) {
            throw new IllegalArgumentException(i18n("ecosystem.error.source.empty"));
        }
        if (!isBlank(request.getImportTarget()) && !"knowledgeBase".equalsIgnoreCase(request.getImportTarget())) {
            throw new IllegalArgumentException(i18n("ecosystem.error.personal.knowledge.base.only"));
        }
    }

    /**
     * 规范化任务状态并限制可更新状态集合。
     */
    private String normalizeTaskStatus(String status) {
        String value = defaultText(status, STATUS_CREATED).toUpperCase(Locale.ROOT);
        if (STATUS_CREATED.equals(value) || STATUS_DISABLED.equals(value) || STATUS_ARCHIVED.equals(value)) {
            return value;
        }
        throw new IllegalArgumentException(i18n("ecosystem.error.task.status.unsupported", status));
    }

    /**
     * 按连接器给出预估输出数量，保留给列表摘要和后续统计兜底。
     */
    private int outputCount(String connectorCode) {
        Map<String, Integer> outputCounts = new LinkedHashMap<>();
        outputCounts.put("zhihu", 12);
        outputCounts.put("github", 18);
        outputCounts.put("web", 8);
        outputCounts.put("mail", 24);
        outputCounts.put("dingtalk", 16);
        return outputCounts.getOrDefault(defaultText(connectorCode, "").toLowerCase(Locale.ROOT), 6);
    }

    /**
     * 按连接器给出预估失败数量，保留给列表摘要和后续统计兜底。
     */
    private int failedCount(String connectorCode) {
        return "mail".equalsIgnoreCase(connectorCode) ? 1 : 0;
    }

    /**
     * 从产物行中解析最合适的存储路径字段。
     */
    private String artifactStoragePath(ResultSet rs) throws SQLException {
        String markdownPath = rs.getString("markdown_path");
        if (!isBlank(markdownPath)) {
            return markdownPath;
        }
        String rawPath = rs.getString("raw_path");
        if (!isBlank(rawPath)) {
            return rawPath;
        }
        String assetDir = rs.getString("asset_dir");
        if (!isBlank(assetDir)) {
            return assetDir;
        }
        return rs.getString("manifest_path");
    }

    /**
     * 从连接器能力 JSON 中提取能力列表。
     */
    private List<String> capabilities(Map<String, Object> capabilitySchema) {
        Object capabilities = capabilitySchema.get("capabilities");
        if (capabilities instanceof List<?> list) {
            List<String> values = new ArrayList<>();
            for (Object item : list) {
                values.add(String.valueOf(item));
            }
            return values;
        }
        return Collections.emptyList();
    }

    /**
     * Map 空值兜底。
     */
    private Map<String, Object> defaultMap(Map<String, Object> value) {
        return value == null ? Collections.emptyMap() : value;
    }

    /**
     * 将任意 key 类型的 Map 转为 String key 的 Map。
     */
    private Map<String, Object> objectMap(Map<?, ?> value) {
        Map<String, Object> result = new LinkedHashMap<>();
        if (value == null) {
            return result;
        }
        for (Map.Entry<?, ?> entry : value.entrySet()) {
            if (entry.getKey() != null) {
                result.put(String.valueOf(entry.getKey()), entry.getValue());
            }
        }
        return result;
    }

    /**
     * 将对象转换为字符串列表，支持 List、逗号分隔字符串和单值。
     */
    private List<String> stringList(Object value) {
        if (value == null) {
            return Collections.emptyList();
        }
        if (value instanceof List<?> list) {
            List<String> result = new ArrayList<>();
            for (Object item : list) {
                if (item != null && !isBlank(String.valueOf(item))) {
                    result.add(String.valueOf(item).trim());
                }
            }
            return result;
        }
        if (value instanceof String text) {
            if (isBlank(text)) {
                return Collections.emptyList();
            }
            String[] parts = text.split("[,，]");
            List<String> result = new ArrayList<>();
            for (String part : parts) {
                if (!isBlank(part)) {
                    result.add(part.trim());
                }
            }
            return result;
        }
        return List.of(String.valueOf(value));
    }

    /**
     * 将心跳请求中的站点登录态转换为对外状态视图。
     */
    private List<EcosystemAgentStatusVo.SiteSessionVo> defaultSiteSessions(
        List<EcosystemAgentHeartbeatRequest.SiteSessionRequest> siteSessions) {
        if (siteSessions == null) {
            return Collections.emptyList();
        }
        List<EcosystemAgentStatusVo.SiteSessionVo> values = new ArrayList<>();
        for (EcosystemAgentHeartbeatRequest.SiteSessionRequest siteSession : siteSessions) {
            EcosystemAgentStatusVo.SiteSessionVo value = new EcosystemAgentStatusVo.SiteSessionVo();
            value.setSiteCode(siteSession.getSiteCode());
            value.setSiteName(siteSession.getSiteName());
            value.setStatus(siteSession.getStatus());
            value.setStatusName(siteSession.getStatusName());
            values.add(value);
        }
        return values;
    }

    /**
     * 构造运行需要用户处理的 payload。
     */
    private Map<String, Object> needActionPayload(EcosystemRunVo run) {
        Map<String, Object> payload = new LinkedHashMap<>();
        putIfPresent(payload, "message", run.getNeedActionMessage());
        putIfPresent(payload, "needActionType", run.getNeedActionType());
        return payload;
    }

    /**
     * 根据异常类型解析需要用户处理的动作类型。
     */
    private String resolveNeedActionType(RuntimeException exception) {
        if (exception instanceof OpenCliRunner.OpenCliException openCliException) {
            return openCliException.getNeedActionType();
        }
        return "RUN_FAILED";
    }

    /**
     * 生成运行失败提示，OpenCLI 错误会拼接截断后的命令输出。
     */
    private String resolveNeedActionMessage(RuntimeException exception) {
        String message = exception.getMessage();
        if (exception instanceof OpenCliRunner.OpenCliException openCliException) {
            String output = openCliException.getCommandResult() == null ? "" : openCliException.getCommandResult()
                .getOutput();
            if (!isBlank(output)) {
                message = defaultText(message, i18n("ecosystem.error.opencli.failed")) + ": "
                    + abbreviate(output, 360);
            }
        }
        return defaultText(message, i18n("ecosystem.error.run.failed"));
    }

    /**
     * 当值不为空时写入 Map。
     */
    private void putIfPresent(Map<String, Object> target, String key, Object value) {
        if (value != null && !isBlank(String.valueOf(value))) {
            target.put(key, value);
        }
    }

    /**
     * 当字符串不为空时写入 Map，并去掉前后空白。
     */
    private void putIfPresent(Map<String, Object> target, String key, String value) {
        if (!isBlank(value)) {
            target.put(key, value.trim());
        }
    }

    /**
     * 从 Map 中取字符串，空值时返回默认值。
     */
    private String text(Map<String, Object> values, String key, String defaultValue) {
        Object value = values.get(key);
        return value == null ? defaultValue : String.valueOf(value);
    }

    /**
     * JSON 反序列化，空值返回默认值。
     */
    private <T> T fromJson(String json, TypeReference<T> typeReference, T defaultValue) {
        if (isBlank(json)) {
            return defaultValue;
        }
        try {
            return objectMapper.readValue(json, typeReference);
        }
        catch (JsonProcessingException e) {
            throw new IllegalArgumentException(i18n("ecosystem.error.json.parse"), e);
        }
    }

    /**
     * JSON 序列化，失败时抛出业务异常。
     */
    private String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        }
        catch (JsonProcessingException e) {
            throw new IllegalArgumentException(i18n("ecosystem.error.json.serialize"), e);
        }
    }

    /**
     * SQL Timestamp 转 Date。
     */
    private Date toDate(Timestamp timestamp) {
        return timestamp == null ? null : new Date(timestamp.getTime());
    }

    /**
     * 运行/任务状态编码转展示名称。
     */
    private String statusName(String status) {
        if (STATUS_SUCCESS.equalsIgnoreCase(status)) {
            return i18n("ecosystem.status.success");
        }
        if ("RUNNING".equalsIgnoreCase(status)) {
            return i18n("ecosystem.status.running");
        }
        if (STATUS_SKIPPED.equalsIgnoreCase(status)) {
            return i18n("ecosystem.status.skipped");
        }
        if (STATUS_FAILED.equalsIgnoreCase(status)) {
            return i18n("ecosystem.status.failed");
        }
        if (STATUS_CREATED.equalsIgnoreCase(status)) {
            return i18n("ecosystem.status.created");
        }
        if (STATUS_DISABLED.equalsIgnoreCase(status)) {
            return i18n("ecosystem.status.disabled");
        }
        if (STATUS_ARCHIVED.equalsIgnoreCase(status)) {
            return i18n("ecosystem.status.archived");
        }
        return defaultText(status, "-");
    }

    /**
     * 调度类型编码转展示名称。
     */
    private String scheduleTypeName(String scheduleType) {
        if ("daily".equalsIgnoreCase(scheduleType)) {
            return i18n("ecosystem.schedule.daily");
        }
        if ("weekly".equalsIgnoreCase(scheduleType)) {
            return i18n("ecosystem.schedule.weekly");
        }
        if ("manual".equalsIgnoreCase(scheduleType)) {
            return i18n("ecosystem.schedule.manual");
        }
        if ("once".equalsIgnoreCase(scheduleType)) {
            return i18n("ecosystem.schedule.once");
        }
        return defaultText(scheduleType, "-");
    }

    /**
     * 连接状态编码转展示名称。
     */
    private String connectionStatusName(String status) {
        if ("READY".equalsIgnoreCase(status)) {
            return i18n("ecosystem.connection.status.ready");
        }
        if ("NEED_AUTH".equalsIgnoreCase(status)) {
            return i18n("ecosystem.connection.status.need.auth");
        }
        if ("FAILED".equalsIgnoreCase(status)) {
            return i18n("ecosystem.connection.status.failed");
        }
        if (STATUS_CREATED.equalsIgnoreCase(status)) {
            return i18n("ecosystem.status.created");
        }
        return defaultText(status, "-");
    }

    /**
     * 认证方式编码转展示名称。
     */
    private String authTypeName(String authType) {
        if ("BROWSER".equalsIgnoreCase(authType)) {
            return i18n("ecosystem.auth.browser");
        }
        if ("TOKEN".equalsIgnoreCase(authType)) {
            return "Token";
        }
        if ("OAUTH".equalsIgnoreCase(authType)) {
            return "OAuth";
        }
        if ("IMAP".equalsIgnoreCase(authType)) {
            return "IMAP";
        }
        if ("PUBLIC_URL".equalsIgnoreCase(authType)) {
            return i18n("ecosystem.auth.public.url");
        }
        return defaultText(authType, "-");
    }

    /**
     * 运行位置编码转展示名称。
     */
    private String runLocationName(String runLocation) {
        if ("LOCAL".equalsIgnoreCase(runLocation)) {
            return i18n("ecosystem.run.location.local");
        }
        if ("SERVER".equalsIgnoreCase(runLocation)) {
            return i18n("ecosystem.run.location.server");
        }
        return defaultText(runLocation, "-");
    }

    /**
     * 判断列表中是否包含指定值，忽略大小写。
     */
    private boolean containsIgnoreCase(List<String> values, String expected) {
        for (String value : values) {
            if (expected.equalsIgnoreCase(value)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 当前登录用户 ID。
     */
    private Long currentUserId() {
        return CurrentUserHolder.getCurrentUserId();
    }

    /**
     * 空文本兜底。
     */
    private String defaultText(String value, String defaultValue) {
        return isBlank(value) ? defaultValue : value.trim();
    }

    /**
     * 获取国际化文案。
     */
    private String i18n(String key, Object... args) {
        return I18nUtil.get(key, args);
    }

    /**
     * 当前登录用户编码，调度场景没有登录态时使用 anonymous。
     */
    private String defaultUserCode() {
        return defaultText(CurrentUserHolder.getCurrentUserCode(), "anonymous");
    }

    /**
     * 当前登录用户名称，调度场景没有登录态时使用默认文案。
     */
    private String defaultUserName() {
        return defaultText(CurrentUserHolder.getCurrentUserName(), i18n("ecosystem.current.user"));
    }

    /**
     * 返回列表首个值，列表为空时返回默认值。
     */
    private String firstOrDefault(List<String> values, String defaultValue) {
        return values == null || values.isEmpty() ? defaultValue : values.get(0);
    }

    /**
     * 对象转字符串，保留 null 语义。
     */
    private String stringValue(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    /**
     * 对象转 Long，空值返回 null。
     */
    private Long longValue(Object value) {
        if (value == null || isBlank(String.valueOf(value))) {
            return null;
        }
        if (value instanceof Number number) {
            return number.longValue();
        }
        return Long.valueOf(String.valueOf(value));
    }

    /**
     * 对象转 int，解析失败时返回默认值。
     */
    private int intValue(Object value, int defaultValue) {
        if (value == null || isBlank(String.valueOf(value))) {
            return defaultValue;
        }
        if (value instanceof Number number) {
            return number.intValue();
        }
        try {
            return Integer.parseInt(String.valueOf(value));
        }
        catch (NumberFormatException e) {
            return defaultValue;
        }
    }

    /**
     * 解析星期配置，支持 1-7 和 DayOfWeek 英文枚举。
     */
    private DayOfWeek dayOfWeekValue(Object value) {
        if (value == null || isBlank(String.valueOf(value))) {
            return DayOfWeek.MONDAY;
        }
        String text = String.valueOf(value).trim();
        try {
            int day = Integer.parseInt(text);
            return DayOfWeek.of(Math.max(1, Math.min(7, day)));
        }
        catch (NumberFormatException e) {
            try {
                return DayOfWeek.valueOf(text.toUpperCase(Locale.ROOT));
            }
            catch (IllegalArgumentException ignored) {
                return DayOfWeek.MONDAY;
            }
        }
    }

    /**
     * 获取敏感字符串后四位，用于 Token 脱敏展示。
     */
    private String last4(String value) {
        String text = defaultText(value, "");
        if (text.length() <= 4) {
            return text;
        }
        return text.substring(text.length() - 4);
    }

    /**
     * 将信号名称规范化为可检索、可去重的编码。
     */
    private String normalizeCode(String value) {
        if (value == null) {
            return "unknown";
        }
        return value.trim().toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9\\u4e00-\\u9fa5]+", "_");
    }

    /**
     * 截断长文本，用于错误信息和命令输出摘要。
     */
    private String abbreviate(String value, int maxLength) {
        if (value == null || value.length() <= maxLength) {
            return value;
        }
        return value.substring(0, maxLength) + "...";
    }

    /**
     * 判断文本是否为空。
     */
    private boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }

    /**
     * 待调度任务引用。
     */
    private record ScheduledTaskRef(Long taskId, Long createdBy, String scheduleType) {
    }

    /**
     * 知识库目标引用。
     */
    private record KnowledgeTarget(Long resourceId, String resourceName, Long catalogId) {
    }
}
