package com.iwhalecloud.byai.manager.application.service.ecosystem;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

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
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 生态采集 P0 应用服务。
 * @author qin.guoquan
 * @date 2026-05-29 21:12:18
 */
@Service
public class EcosystemCollectionApplicationService extends EcosystemCollectionSupport {

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
     * 用户本机 Browser Bridge 长连接采集服务，承接任务下发、租约和结果回传。
     */
    @Autowired
    private EcosystemBrowserBridgeService browserBridgeService;

    /**
     * 连接配置和登录态服务。
     */
    @Autowired
    private EcosystemConnectionService connectionService;

    /**
     * 任务定义和调度锁服务。
     */
    @Autowired
    private EcosystemTaskService taskService;

    /**
     * OpenCLI manifest 能力目录，用于动态放开 OpenCLI 支持的采集站点。
     */
    @Autowired
    private OpenCliCapabilityService openCliCapabilityService;

    /**
     * 环境配置读取器，用于生成跨 OpenClaw 沙箱可访问的门户绝对链接。
     */
    @Autowired
    private Environment environment;

    /**
     * 查询启用的生态连接器能力清单。
     */
    public List<EcosystemConnectorVo> listConnectors() {
        return connectionService.listConnectors();
    }

    /**
     * 获取当前用户最近一次浏览器登录态能力状态；没有心跳时返回离线默认状态。
     */
    public EcosystemAgentStatusVo getLocalAgentStatus() {
        return connectionService.getLocalAgentStatus();
    }

    /**
     * 查询当前用户的连接配置，可按连接器编码过滤。
     */
    public List<Map<String, Object>> listConnections(String connectorCode) {
        return connectionService.listConnections(connectorCode);
    }

    /**
     * 保存连接配置。
     */
    public Map<String, Object> saveConnection(Map<String, Object> request) {
        return connectionService.saveConnection(request);
    }

    /**
     * 创建生态采集任务，并持久化采集范围、入库目标、信号和调度配置。
     *
     * @param request 任务创建请求
     * @return 创建后的任务视图
     */
    @Transactional(rollbackFor = Exception.class)
    public EcosystemTaskVo createTask(EcosystemTaskCreateRequest request) {
        return taskService.createTask(request);
    }

    /**
     * 查询当前用户的采集任务列表，并带出最近一次运行概览。
     *
     * @return 任务列表
     */
    public List<EcosystemTaskVo> listTasks() {
        return taskService.listTasks();
    }

    /**
     * 定时扫描到期任务并触发运行。该方法由 Spring Scheduler 调用。
     */
    @Scheduled(fixedDelayString = "${bykc.ecosystem.scheduler.fixed-delay-ms:60000}",
        initialDelayString = "${bykc.ecosystem.scheduler.initial-delay-ms:30000}")
    public void dispatchScheduledRuns() {
        browserBridgeService.recoverExpiredLeases();
        for (ScheduledTaskRef taskRef : taskService.listDueScheduledTasks()) {
            if (!taskService.lockScheduledTask(taskRef)) {
                continue;
            }
            try {
                taskService.runAsUser(taskRef.createdBy(), () -> startRunInternal(taskRef.taskId(), "SCHEDULED",
                    taskRef.createdBy()));
            }
            catch (RuntimeException e) {
                taskService.markScheduledRunFailure(taskRef, e);
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
        return taskService.updateTaskStatus(request);
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
        EcosystemTaskVo task = taskService.findTask(taskId, userId);
        if (STATUS_DISABLED.equalsIgnoreCase(task.getStatus()) || STATUS_ARCHIVED.equalsIgnoreCase(task.getStatus())) {
            throw new IllegalArgumentException(i18n("ecosystem.error.task.not.runnable"));
        }
        Map<String, Object> targetConfig = taskService.findTaskTargetConfig(task.getTaskId(), userId);
        Long runId = sequenceService.nextVal();
        OpenCliRunner.CollectionResult collectionResult = null;
        EcosystemArtifactStorageService.StorageResult storageResult = null;
        EcosystemRunVo run;
        try {
            if (requiresUserBrowserBridge(task.getCollectMode())) {
                return browserBridgeService.startRun(task, targetConfig, runId, triggerType, userId);
            }
            if (!isExecutableCollectMode(task.getCollectMode())) {
                throw new IllegalStateException(i18n("ecosystem.error.collect.mode.not.executable",
                    collectModeName(task.getCollectMode())));
            }
            connectionService.attachConnectionCredentialConfig(task);
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
     * Browser Bridge 绑定或重连后拉取当前用户未完成的长连接采集任务。
     */
    public List<Map<String, Object>> listPendingBrowserBridgeTasks(Long userId) {
        return browserBridgeService.listPendingTasks(userId);
    }

    /**
     * Browser Bridge 绑定或重连后拉取当前用户未完成、且未被其他设备有效租约占用的任务。
     */
    public List<Map<String, Object>> listPendingBrowserBridgeTasks(Long userId, String bridgeClientId) {
        return browserBridgeService.listPendingTasks(userId, bridgeClientId);
    }

    /**
     * Bridge 客户端领取任务租约。领取成功后才允许执行页面动作和回传结果。
     */
    @Transactional(rollbackFor = Exception.class)
    public Map<String, Object> claimBrowserBridgeTask(Map<String, Object> request, Long userId) {
        return browserBridgeService.claimTask(request, userId);
    }

    /**
     * Bridge 客户端续租，防止长页面滚动、登录跳转或慢网环境中被其他设备接管。
     */
    @Transactional(rollbackFor = Exception.class)
    public Map<String, Object> renewBrowserBridgeLease(Map<String, Object> request, Long userId) {
        return browserBridgeService.renewLease(request, userId);
    }

    /**
     * 接收 Browser Bridge 成功结果，完成产物落地、知识库入库和运行状态回写。
     */
    @Transactional(rollbackFor = Exception.class)
    public EcosystemRunVo completeBrowserBridgeRun(Map<String, Object> request, Long userId) {
        return browserBridgeService.completeRun(request, userId);
    }

    /**
     * 接收 Browser Bridge 失败结果，按真实运行失败落库。
     */
    @Transactional(rollbackFor = Exception.class)
    public EcosystemRunVo failBrowserBridgeRun(Map<String, Object> request, Long userId) {
        return browserBridgeService.failRun(request, userId);
    }

    /**
     * 接收 Browser Bridge 取消结果，或由门户主动取消一个仍在运行的 Bridge 任务。
     */
    @Transactional(rollbackFor = Exception.class)
    public EcosystemRunVo cancelBrowserBridgeRun(Map<String, Object> request, Long userId) {
        return browserBridgeService.cancelRun(request, userId);
    }

    /**
     * 接收 Browser Bridge 执行进度，刷新运行主状态和待处理提示。
     */
    @Transactional(rollbackFor = Exception.class)
    public EcosystemRunVo updateBrowserBridgeProgress(Map<String, Object> request, Long userId) {
        return browserBridgeService.updateProgress(request, userId);
    }

    /**
     * 接收浏览器登录态能力心跳并刷新状态。
     */
    public EcosystemAgentStatusVo heartbeat(EcosystemAgentHeartbeatRequest request) {
        return connectionService.heartbeat(request);
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
        return getRunAsUser(runId, currentUserId());
    }

    /**
     * 按指定用户查询运行详情，供 Browser Bridge WebSocket 回调使用。
     */
    private EcosystemRunVo getRunAsUser(Long runId, Long userId) {
        List<EcosystemRunVo> runs = jdbcTemplate.query("""
            SELECT r.run_id, r.task_id, r.status, r.current_step, r.total_count, r.markdown_count, r.asset_count,
                   r.failed_count, r.need_action_type, CAST(r.need_action_payload AS TEXT) AS need_action_payload,
                   r.storage_path, r.started_at, r.finished_at, CAST(t.target_config AS TEXT) AS target_config
              FROM byai.bykc_ec_sync_run r
              JOIN byai.bykc_ec_sync_task t ON t.task_id = r.task_id
             WHERE r.run_id = ? AND t.created_by = ?
            """, runRowMapper(), runId, userId);
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
     * 处理运行中的用户动作，例如重试、重新检测浏览器登录态能力、跳过或确认。
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
        Long userId = currentUserId();
        if (runId == null) {
            throw new IllegalArgumentException(i18n("ecosystem.error.run.id.empty"));
        }
        if ("RETRY".equals(action)) {
            Long taskId = taskService.findRunTaskId(runId);
            return startRunInternal(taskId, "RETRY", userId);
        }
        if ("RECHECK_BROWSER_BRIDGE".equals(action)) {
            return getRun(runId);
        }
        if ("CANCEL".equals(action)) {
            Long taskId = taskService.findRunTaskId(runId);
            EcosystemTaskVo task = taskService.findTask(taskId, userId);
            if (requiresUserBrowserBridge(task.getCollectMode())) {
                browserBridgeService.dispatchCancel(userId, runId);
            }
            return skipRun(runId, task, userId, i18n("ecosystem.run.action.cancelled.message"), "CANCELED",
                i18n("ecosystem.run.action.cancelled.step"));
        }
        if ("SKIP".equals(action)) {
            Long taskId = taskService.findRunTaskId(runId);
            EcosystemTaskVo task = taskService.findTask(taskId, userId);
            return skipRun(runId, task, userId, i18n("ecosystem.run.action.skipped.message"), "SKIPPED",
                i18n("ecosystem.run.action.skipped.step"));
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
        )), runId, userId);
        return getRun(runId);
    }

    /**
     * 将一次运行结束为已跳过或已取消，并同步任务主状态。
     */
    private EcosystemRunVo skipRun(Long runId, EcosystemTaskVo task, Long userId, String message, String actionStatus,
                                   String stepMessage) {
        jdbcTemplate.update("""
            UPDATE byai.bykc_ec_sync_run
               SET status = ?, current_step = ?, need_action_type = NULL,
                   need_action_payload = CAST(? AS JSONB), finished_at = ?
             WHERE run_id = ? AND task_id = ?
            """, STATUS_SKIPPED, actionStatus, toJson(Map.of(
                "message", message,
                "actionStatus", actionStatus
            )), new Date(), runId, task.getTaskId());
        jdbcTemplate.update("""
            UPDATE byai.bykc_ec_sync_run_step
               SET status = ?, message = ?
             WHERE run_id = ? AND status IN ('RUNNING', 'CREATED', 'FAILED')
            """, STATUS_SKIPPED, stepMessage, runId);
        EcosystemRunVo run = getRunAsUser(runId, userId);
        finalizeTaskAfterRun(task, run, userId, "MANUAL");
        return getRunAsUser(runId, userId);
    }

    /**
     * 运行结束后回写任务状态和下一次调度时间。
     */
    private void finalizeTaskAfterRun(EcosystemTaskVo task, EcosystemRunVo run, Long userId, String triggerType) {
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
     * 归一化聊天/技能采集计划，补齐来源、运行位置、默认知识库、连接配置和缺失动作。
     */
    private Map<String, Object> normalizeChatPlan(Map<String, Object> request, boolean createDefaultKnowledgeBase) {
        Map<String, Object> input = new LinkedHashMap<>(defaultMap(request));
        String rawText = defaultText(stringValue(input.get("originalText")), stringValue(input.get("text")));
        String sourceUrl = defaultText(stringValue(input.get("sourceUrl")), extractFirstUrl(rawText));
        String connectorCode = defaultText(stringValue(input.get("connectorCode")), inferConnectorCode(sourceUrl, rawText));
        EcosystemConnectorVo connector = connectionService.findConnector(connectorCode);
        OpenCliCapabilityService.CommandCapability openCliCommand = openCliCapabilityService.selectReadCommand(
            connector.getConnectorCode(),
            stringValue(input.get("openCliCommand")),
            sourceUrl,
            stringValue(input.get("scope")),
            rawText).orElse(null);
        KnowledgeTarget knowledgeTarget = resolveKnowledgeTarget(input, createDefaultKnowledgeBase);
        Map<String, Object> connection = connectionService.findPreferredConnection(connector.getConnectorCode());
        EcosystemAgentStatusVo agentStatus = getLocalAgentStatus();
        String collectMode = normalizeCollectMode(defaultChatCollectMode(connector, input, openCliCommand), connector);
        String authType = defaultText(stringValue(input.get("authType")), defaultAuthType(connector, collectMode));
        String scope = stringValue(input.get("scope"));
        if (isMailBrowserBridge(connector, collectMode) && !isExplicitImapRequest(input)) {
            authType = "BROWSER";
            if (isMailProtocolSource(sourceUrl)) {
                scope = defaultText(scope, mailProtocolScope(sourceUrl));
                sourceUrl = "";
            }
        }
        String runLocation = defaultText(stringValue(input.get("runLocation")), defaultRunLocation(collectMode));
        List<String> missingActions = new ArrayList<>();
        if (requiresSourceUrl(connector.getConnectorCode()) && isBlank(sourceUrl)) {
            missingActions.add("SOURCE_URL");
        }
        if (requiresUserBrowserBridge(collectMode) && !Boolean.TRUE.equals(agentStatus.getConnected())) {
            missingActions.add("BROWSER_BRIDGE");
        }
        if (requiresUserBrowserBridge(collectMode) && Boolean.TRUE.equals(agentStatus.getConnected())
            && isSiteLoginMissing(connector, agentStatus)) {
            missingActions.add("SITE_LOGIN");
        }
        if (requiresSavedConnection(authType) && !"READY".equalsIgnoreCase(text(connection, "status", ""))) {
            missingActions.add("CONNECTION");
        }
        if (createDefaultKnowledgeBase && knowledgeTarget.resourceId() == null) {
            missingActions.add("DEFAULT_KNOWLEDGE_BASE");
        }

        Map<String, Object> plan = new LinkedHashMap<>();
        plan.put("entry", "skill");
        plan.put("plannerVersion", "2026-06-02-opencli-manifest-routing");
        putIfPresent(plan, "chatSessionId", input.get("chatSessionId"));
        putIfPresent(plan, "chatQueryMessageId", input.get("chatQueryMessageId"));
        putIfPresent(plan, "originalText", rawText);
        plan.put("taskName", defaultText(stringValue(input.get("taskName")),
            i18n("ecosystem.skill.collection.default.name", connector.getConnectorName())));
        plan.put("connectorCode", connector.getConnectorCode());
        plan.put("connectorName", connector.getConnectorName());
        if (openCliCommand != null) {
            plan.put("openCliSite", openCliCommand.site());
            plan.put("openCliCommand", openCliCommand.name());
            plan.put("openCliStrategy", openCliCommand.strategy());
            plan.put("openCliBrowser", openCliCommand.requiresBrowserBridge());
            putIfPresent(plan, "openCliDomain", openCliCommand.domain());
        }
        plan.put("sourceUrl", sourceUrl);
        plan.put("scope", defaultText(scope,
            isBlank(sourceUrl) ? i18n("ecosystem.scope.recent") : i18n("ecosystem.scope.link")));
        plan.put("ownerType", "personal");
        plan.put("collectMode", collectMode);
        plan.put("collectModeName", collectModeName(collectMode));
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
        plan.put("browserBridge", agentStatus);
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
        request.setCollectMode(stringValue(plan.get("collectMode")));
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
        putIfPresent(options, "collectMode", plan.get("collectMode"));
        putIfPresent(options, "openCliSite", plan.get("openCliSite"));
        putIfPresent(options, "openCliCommand", plan.get("openCliCommand"));
        putIfPresent(options, "openCliStrategy", plan.get("openCliStrategy"));
        putIfPresent(options, "openCliDomain", plan.get("openCliDomain"));
        putIfPresent(options, "openCliBrowser", plan.get("openCliBrowser"));
        putIfPresent(options, "connectorName", plan.get("connectorName"));
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
        String collectMode = text(plan, "collectModeName", "-");
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
            + "\n- " + i18n("ecosystem.card.label.collect.mode") + ": " + collectMode
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
        if (hasMissingAction(plan, "BROWSER_BRIDGE")) {
            buttons.add(linkButton(i18n("ecosystem.action.connect.browser.bridge"),
                knowledgeCenterLink(plan, false, "browserBridge")));
        }
        if (hasMissingAction(plan, "SITE_LOGIN")) {
            buttons.add(linkButton(i18n("ecosystem.action.open.source.login"),
                knowledgeCenterLink(plan, false, "browserBridge")));
        }
        buttons.add(linkButton(i18n("ecosystem.action.choose.knowledge.base"),
            knowledgeCenterLink(plan, true, "knowledgeBase")));
        buttons.add(linkButton(i18n("ecosystem.action.configure"), knowledgeCenterLink(plan, false, "connection")));
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
            if ("BROWSER_BRIDGE".equals(action)) {
                texts.add(i18n("ecosystem.missing.browser.bridge"));
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
            else if ("SITE_LOGIN".equals(action)) {
                texts.add(i18n("ecosystem.missing.site.login", text(plan, "connectorName", "")));
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
    private String knowledgeCenterLink(Map<String, Object> plan, boolean chooseKnowledgeBase, String focus) {
        StringBuilder url = new StringBuilder(portalPageUrl("/knowledgeCenter"));
        url.append("?ecosystem=1&tab=personal");
        appendUrlParam(url, "source", text(plan, "connectorCode", ""));
        appendUrlParam(url, "sourceUrl", text(plan, "sourceUrl", ""));
        appendUrlParam(url, "scope", text(plan, "scope", ""));
        appendUrlParam(url, "collectMode", text(plan, "collectMode", ""));
        appendUrlParam(url, "authType", text(plan, "authType", ""));
        appendUrlParam(url, "runLocation", text(plan, "runLocation", ""));
        appendUrlParam(url, "focus", defaultText(focus, chooseKnowledgeBase ? "knowledgeBase" : ""));
        return url.toString();
    }

    /**
     * 生成门户页面绝对地址，避免 OpenClaw 卡片把相对地址解析到 openclaw.ai 域名。
     */
    private String portalPageUrl(String path) {
        return composePortalBaseUrl() + "/" + trimLeadingSlash(path);
    }

    /**
     * 按现有部署配置拼接百应门户基础地址。
     */
    private String composePortalBaseUrl() {
        String host = configured("HOST", "127.0.0.1");
        String localDevPort = configured("BYCLAW_QA_PORT", "");
        if (isLocalHost(host) && !isBlank(localDevPort)) {
            return "http://localhost:" + localDevPort;
        }
        String port = configured("NGINX_PORT", "8080");
        StringBuilder baseUrl = new StringBuilder();
        baseUrl.append("http://").append(host);
        if (!isBlank(port)) {
            baseUrl.append(":").append(port);
        }
        return baseUrl.append("/beyond").toString();
    }

    /**
     * 判断是否本机开发访问地址。本机前端 dev server 不挂 /beyond，跳转要回到 localhost:8000。
     */
    private boolean isLocalHost(String host) {
        return "127.0.0.1".equals(host) || "localhost".equalsIgnoreCase(host) || "::1".equals(host);
    }

    /**
     * 读取环境配置，空值时返回默认值。
     */
    private String configured(String key, String defaultValue) {
        String value = environment.getProperty(key);
        return defaultText(value, defaultValue);
    }

    /**
     * 去掉路径开头的斜杠。
     */
    private String trimLeadingSlash(String value) {
        String text = defaultText(value, "");
        while (text.startsWith("/")) {
            text = text.substring(1);
        }
        return text;
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
        return openCliCapabilityService.inferSiteCode(sourceUrl, rawText).orElse("web");
    }

    /**
     * 对话入口的采集模式默认值。邮箱默认走 QQ 邮箱网页版 Browser Bridge；只有明确选择 IMAP
     * 或服务端 OpenCLI 时，才回到邮箱 IMAP 授权链路。
     */
    private String defaultChatCollectMode(EcosystemConnectorVo connector, Map<String, Object> input,
                                          OpenCliCapabilityService.CommandCapability openCliCommand) {
        String collectMode = stringValue(input.get("collectMode"));
        if ("mail".equalsIgnoreCase(connector.getConnectorCode())) {
            if (!isExplicitImapRequest(input)) {
                return COLLECT_MODE_USER_BROWSER_BRIDGE;
            }
            if (isBlank(collectMode)) {
                return COLLECT_MODE_SERVER_OPENCLI;
            }
        }
        if (isBlank(collectMode) && openCliCommand != null) {
            return openCliCommand.requiresBrowserBridge()
                ? COLLECT_MODE_USER_BROWSER_BRIDGE
                : COLLECT_MODE_SERVER_OPENCLI;
        }
        return collectMode;
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
     * Browser Bridge 已连接时继续校验站点登录态。QQ 邮箱没有登录态时先给出明确指引。
     */
    private boolean isSiteLoginMissing(EcosystemConnectorVo connector, EcosystemAgentStatusVo agentStatus) {
        if (agentStatus == null || agentStatus.getSiteSessions() == null) {
            return "mail".equalsIgnoreCase(connector.getConnectorCode());
        }
        for (EcosystemAgentStatusVo.SiteSessionVo siteSession : agentStatus.getSiteSessions()) {
            if (!matchesSiteSession(connector.getConnectorCode(), siteSession)) {
                continue;
            }
            String status = defaultText(siteSession.getStatus(), "");
            return "NEED_LOGIN".equalsIgnoreCase(status) || "EXPIRED".equalsIgnoreCase(status);
        }
        return "mail".equalsIgnoreCase(connector.getConnectorCode());
    }

    private boolean matchesSiteSession(String connectorCode, EcosystemAgentStatusVo.SiteSessionVo siteSession) {
        String siteCode = defaultText(siteSession.getSiteCode(), "");
        if (connectorCode.equalsIgnoreCase(siteCode)) {
            return true;
        }
        return "mail".equalsIgnoreCase(connectorCode) && "qqmail".equalsIgnoreCase(siteCode);
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
}
