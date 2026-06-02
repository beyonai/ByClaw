package com.iwhalecloud.byai.manager.application.service.ecosystem;
import java.math.BigDecimal;
import java.net.URI;
import java.nio.file.Path;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.DayOfWeek;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import com.alibaba.fastjson.JSONObject;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.vo.ecosystem.EcosystemRunVo;
import com.iwhalecloud.byai.manager.vo.ecosystem.EcosystemSignalVo;
import com.iwhalecloud.byai.manager.vo.ecosystem.EcosystemTaskVo;
import com.iwhalecloud.byai.state.domain.chat.enums.MessageType;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
/**
 * 用户本机 Browser Bridge 长连接采集服务。
 *
 * <p>这里集中处理 Bridge 的任务下发、租约、进度、结果回传和断线恢复，避免主应用服务继续膨胀。</p>
 *
 * @author qin.guoquan
 * @date 2026-05-29 21:12:18
 */
@Service
public class EcosystemBrowserBridgeService {
    private static final Pattern MAIL_DAYS_PATTERN = Pattern.compile("(?:最近|近)\\s*(\\d{1,3})\\s*天");
    private static final String STATUS_CREATED = "CREATED";
    private static final String STATUS_SUCCESS = "SUCCESS";
    private static final String STATUS_FAILED = "FAILED";
    private static final String STATUS_SKIPPED = "SKIPPED";
    private static final String COLLECT_MODE_SERVER_OPENCLI = "SERVER_OPENCLI";
    private static final String COLLECT_MODE_USER_BROWSER_BRIDGE = "USER_BROWSER_BRIDGE";
    private static final long BROWSER_BRIDGE_LEASE_TTL_MS = 120_000L;
    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {
    };
    private static final TypeReference<List<Map<String, Object>>> MAP_LIST_TYPE = new TypeReference<>() {
    };
    private static final TypeReference<List<EcosystemSignalVo>> SIGNAL_LIST_TYPE = new TypeReference<>() {
    };
    @Autowired
    private JdbcTemplate jdbcTemplate;
    @Autowired
    private ObjectMapper objectMapper;
    @Autowired
    private SequenceService sequenceService;
    @Autowired
    private MultiDeviceBroadcastService multiDeviceBroadcastService;
    @Autowired
    private EcosystemArtifactStorageService artifactStorageService;
    @Autowired
    private EcosystemKnowledgeImportService knowledgeImportService;
    @Autowired
    private OpenCliCapabilityService openCliCapabilityService;
    public EcosystemRunVo startRun(EcosystemTaskVo task, Map<String, Object> targetConfig, Long runId,
                                   String triggerType, Long userId) {
        validateBridgeTask(task);
        EcosystemRunVo run = buildPendingRun(runId, task, userId);
        saveRun(run, task, triggerType, targetConfig);
        jdbcTemplate.update("""
            UPDATE byai.bykc_ec_sync_task
               SET status = ?, update_time = ?
             WHERE task_id = ? AND created_by = ?
            """, "RUNNING", new Date(), task.getTaskId(), userId);
        int sentCount = dispatchTask(userId, run, task);
        if (sentCount == 0) {
            updateProgress(Map.of(
                "runId", runId,
                "currentStep", "WAIT_BROWSER_BRIDGE",
                "message", i18n("ecosystem.bridge.waiting.reconnect")
            ), userId);
            return getRunAsUser(runId, userId);
        }
        return run;
    }
    public List<Map<String, Object>> listPendingTasks(Long userId) {
        return listPendingTasks(userId, "");
    }
    public List<Map<String, Object>> listPendingTasks(Long userId, String bridgeClientId) {
        List<Map<String, Object>> refs = jdbcTemplate.query("""
            SELECT r.run_id, r.task_id
              FROM byai.bykc_ec_sync_run r
              JOIN byai.bykc_ec_sync_task t ON t.task_id = r.task_id
             WHERE t.created_by = ?
               AND r.status = 'RUNNING'
             ORDER BY r.create_time ASC, r.run_id ASC
            """, (rs, rowNum) -> Map.of(
            "runId", rs.getLong("run_id"),
            "taskId", rs.getLong("task_id")), userId);
        List<Map<String, Object>> tasks = new ArrayList<>();
        for (Map<String, Object> ref : refs) {
            EcosystemTaskVo task = findTask(longValue(ref.get("taskId")), userId);
            if (requiresUserBrowserBridge(task.getCollectMode())) {
                Long runId = longValue(ref.get("runId"));
                Map<String, Object> leasePayload = loadRunNeedActionPayload(runId, userId, false);
                if (isLeaseVisibleToClient(leasePayload, bridgeClientId)) {
                    EcosystemRunVo run = getRunAsUser(runId, userId);
                    tasks.add(taskPayload(run, task, leasePayload));
                }
            }
        }
        return tasks;
    }
    @Transactional(rollbackFor = Exception.class)
    public Map<String, Object> claimTask(Map<String, Object> request, Long userId) {
        Long runId = requireRunId(request);
        Long taskId = findRunTaskId(runId, userId);
        EcosystemTaskVo task = findTask(taskId, userId);
        ensureBridgeRun(task, runId, userId);
        String bridgeClientId = requiredBridgeClientId(request);
        Map<String, Object> payload = loadRunNeedActionPayload(runId, userId, true);
        long now = System.currentTimeMillis();
        String existingLeaseId = stringValue(payload.get("bridgeLeaseId"));
        String existingHolder = stringValue(payload.get("bridgeLeaseHolder"));
        Long storedExpiresAt = longValue(payload.get("bridgeLeaseExpiresAtMs"));
        long existingExpiresAt = storedExpiresAt == null ? 0L : storedExpiresAt;
        if (!isBlank(existingLeaseId) && existingExpiresAt > now && !bridgeClientId.equals(existingHolder)) {
            return leaseResponse(false, runId, null, existingExpiresAt, i18n("ecosystem.bridge.lease.denied"), null);
        }
        String leaseId = UUID.randomUUID().toString();
        long expiresAt = now + BROWSER_BRIDGE_LEASE_TTL_MS;
        payload.put("message", i18n("ecosystem.bridge.lease.claimed"));
        payload.put("actionStatus", "LEASED");
        payload.put("bridgeLeaseRequired", true);
        payload.put("bridgeLeaseId", leaseId);
        payload.put("bridgeLeaseHolder", bridgeClientId);
        payload.put("bridgeLeaseStartedAtMs", now);
        payload.put("bridgeLeaseExpiresAtMs", expiresAt);
        payload.put("bridgeLeaseTtlMs", BROWSER_BRIDGE_LEASE_TTL_MS);
        updateRunNeedActionPayload(runId, userId, "USER_BROWSER_BRIDGE_LEASED", payload);
        EcosystemRunVo run = getRunAsUser(runId, userId);
        return leaseResponse(true, runId, leaseId, expiresAt, i18n("ecosystem.bridge.lease.claimed"),
            taskPayload(run, task, payload));
    }
    @Transactional(rollbackFor = Exception.class)
    public Map<String, Object> renewLease(Map<String, Object> request, Long userId) {
        Long runId = requireRunId(request);
        findRunTaskId(runId, userId);
        Map<String, Object> payload = ensureLease(runId, userId, request);
        long expiresAt = System.currentTimeMillis() + BROWSER_BRIDGE_LEASE_TTL_MS;
        payload.put("message", i18n("ecosystem.bridge.lease.renewed"));
        payload.put("actionStatus", "LEASED");
        payload.put("bridgeLeaseExpiresAtMs", expiresAt);
        payload.put("bridgeLeaseTtlMs", BROWSER_BRIDGE_LEASE_TTL_MS);
        updateRunNeedActionPayload(runId, userId, "USER_BROWSER_BRIDGE_LEASED", payload);
        return leaseResponse(true, runId, stringValue(payload.get("bridgeLeaseId")), expiresAt,
            i18n("ecosystem.bridge.lease.renewed"), null);
    }
    @Transactional(rollbackFor = Exception.class)
    public EcosystemRunVo completeRun(Map<String, Object> request, Long userId) {
        Long runId = requireRunId(request);
        Long taskId = findRunTaskId(runId, userId);
        EcosystemTaskVo task = findTask(taskId, userId);
        ensureBridgeRun(task, runId, userId);
        ensureLease(runId, userId, request);
        Map<String, Object> targetConfig = findTaskTargetConfig(task.getTaskId(), userId);
        OpenCliRunner.CollectionResult collectionResult = buildCollectionResult(task, request);
        EcosystemArtifactStorageService.StorageResult storageResult = null;
        EcosystemRunVo run;
        try {
            storageResult = artifactStorageService.store(runId, task, collectionResult);
            EcosystemKnowledgeImportService.ImportResult importResult =
                knowledgeImportService.importMarkdown(task, targetConfig, storageResult.getMarkdownFiles());
            run = buildSuccessRun(runId, task, collectionResult, storageResult, importResult);
        }
        catch (RuntimeException e) {
            run = buildFailedRun(runId, task, userId, e, collectionResult, storageResult);
        }
        replaceRun(run, task, targetConfig);
        finalizeTaskAfterRun(task, run, userId, "MANUAL");
        return getRunAsUser(runId, userId);
    }
    @Transactional(rollbackFor = Exception.class)
    public EcosystemRunVo failRun(Map<String, Object> request, Long userId) {
        Long runId = requireRunId(request);
        Long taskId = findRunTaskId(runId, userId);
        EcosystemTaskVo task = findTask(taskId, userId);
        ensureBridgeRun(task, runId, userId);
        ensureLease(runId, userId, request);
        RuntimeException exception = new IllegalStateException(defaultText(stringValue(request.get("errorMessage")),
            i18n("ecosystem.bridge.result.failed")));
        EcosystemRunVo run = buildFailedRun(runId, task, userId, exception, null, null);
        run.setCurrentStep(defaultText(stringValue(request.get("currentStep")), "PULL_RAW"));
        run.setNeedActionType(defaultText(stringValue(request.get("needActionType")),
            defaultText(run.getNeedActionType(), "USER_BROWSER_BRIDGE_FAILED")));
        replaceRun(run, task, findTaskTargetConfig(task.getTaskId(), userId));
        finalizeTaskAfterRun(task, run, userId, "MANUAL");
        return getRunAsUser(runId, userId);
    }
    @Transactional(rollbackFor = Exception.class)
    public EcosystemRunVo cancelRun(Map<String, Object> request, Long userId) {
        Long runId = requireRunId(request);
        Long taskId = findRunTaskId(runId, userId);
        EcosystemTaskVo task = findTask(taskId, userId);
        ensureBridgeRun(task, runId, userId);
        ensureLease(runId, userId, request);
        return skipRun(runId, task, userId, i18n("ecosystem.run.action.cancelled.message"), "CANCELED",
            i18n("ecosystem.run.action.cancelled.step"));
    }
    @Transactional(rollbackFor = Exception.class)
    public EcosystemRunVo updateProgress(Map<String, Object> request, Long userId) {
        Long runId = requireRunId(request);
        Long taskId = findRunTaskId(runId, userId);
        EcosystemTaskVo task = findTask(taskId, userId);
        ensureBridgeRun(task, runId, userId);
        Map<String, Object> payload = ensureLease(runId, userId, request);
        String currentStep = defaultText(stringValue(request.get("currentStep")), "PULL_RAW");
        payload.put("message", defaultText(stringValue(request.get("message")), i18n("ecosystem.bridge.running")));
        payload.put("actionStatus", "RUNNING");
        putIfPresent(payload, "progress", request.get("progress"));
        putIfPresent(payload, "currentCommand", stringValue(request.get("currentCommand")));
        payload.put("lastProgressAtMs", System.currentTimeMillis());
        jdbcTemplate.update("""
            UPDATE byai.bykc_ec_sync_run
               SET current_step = ?, need_action_type = ?, need_action_payload = CAST(? AS JSONB)
             WHERE run_id = ? AND task_id IN (
                   SELECT task_id FROM byai.bykc_ec_sync_task WHERE created_by = ?
             )
            """, currentStep, "USER_BROWSER_BRIDGE_RUNNING", toJson(payload), runId, userId);
        return getRunAsUser(runId, userId);
    }
    public int dispatchCancel(Long userId, Long runId) {
        JSONObject message = new JSONObject();
        message.put("type", MessageType.ECOSYSTEM_BRIDGE.name());
        message.put("event", "CANCEL_TASK");
        message.put("data", Map.of("runId", String.valueOf(runId)));
        return multiDeviceBroadcastService.broadcastRawToUser(userId, message);
    }
    public void recoverExpiredLeases() {
        long now = System.currentTimeMillis();
        List<Map<String, Object>> refs = jdbcTemplate.query("""
            SELECT r.run_id, r.task_id, t.created_by, t.run_location, CAST(t.options AS TEXT) AS options,
                   CAST(r.need_action_payload AS TEXT) AS need_action_payload
              FROM byai.bykc_ec_sync_run r
              JOIN byai.bykc_ec_sync_task t ON t.task_id = r.task_id
             WHERE r.status = 'RUNNING'
               AND r.need_action_type IN ('USER_BROWSER_BRIDGE_LEASED', 'USER_BROWSER_BRIDGE_RUNNING')
             ORDER BY r.create_time ASC, r.run_id ASC
             LIMIT 50
            """, (rs, rowNum) -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("runId", rs.getLong("run_id"));
            row.put("taskId", rs.getLong("task_id"));
            row.put("createdBy", rs.getLong("created_by"));
            row.put("runLocation", rs.getString("run_location"));
            row.put("options", rs.getString("options"));
            row.put("needActionPayload", rs.getString("need_action_payload"));
            return row;
        });
        for (Map<String, Object> ref : refs) {
            try {
                Map<String, Object> options = fromJson(stringValue(ref.get("options")), MAP_TYPE,
                    Collections.emptyMap());
                String collectMode = defaultText(stringValue(options.get("collectMode")),
                    collectModeFromRunLocation(stringValue(ref.get("runLocation"))));
                if (!requiresUserBrowserBridge(collectMode)) {
                    continue;
                }
                Map<String, Object> payload = new LinkedHashMap<>(fromJson(stringValue(ref.get("needActionPayload")),
                    MAP_TYPE, Collections.emptyMap()));
                Long expiresAt = longValue(payload.get("bridgeLeaseExpiresAtMs"));
                if (expiresAt == null || expiresAt > now) {
                    continue;
                }
                String previousHolder = stringValue(payload.remove("bridgeLeaseHolder"));
                String previousLeaseId = stringValue(payload.remove("bridgeLeaseId"));
                payload.remove("bridgeLeaseStartedAtMs");
                payload.remove("bridgeLeaseExpiresAtMs");
                payload.put("message", i18n("ecosystem.bridge.lease.timeout.requeued"));
                payload.put("actionStatus", "WAITING");
                payload.put("bridgeLeaseRequired", true);
                payload.put("bridgeLeaseTtlMs", BROWSER_BRIDGE_LEASE_TTL_MS);
                payload.put("lastLeaseExpiredAtMs", now);
                putIfPresent(payload, "previousBridgeClientId", previousHolder);
                putIfPresent(payload, "previousLeaseId", previousLeaseId);
                jdbcTemplate.update("""
                    UPDATE byai.bykc_ec_sync_run
                       SET current_step = ?, need_action_type = ?, need_action_payload = CAST(? AS JSONB)
                     WHERE run_id = ? AND status = 'RUNNING'
                    """, "WAIT_BROWSER_BRIDGE", "USER_BROWSER_BRIDGE_WAITING", toJson(payload),
                    longValue(ref.get("runId")));
                jdbcTemplate.update("""
                    UPDATE byai.bykc_ec_sync_run_step
                       SET message = ?
                     WHERE run_id = ? AND step_code = 'PULL_RAW' AND status = 'RUNNING'
                    """, i18n("ecosystem.bridge.lease.timeout.requeued"), longValue(ref.get("runId")));
                Long runId = longValue(ref.get("runId"));
                Long taskId = longValue(ref.get("taskId"));
                Long createdBy = longValue(ref.get("createdBy"));
                if (runId != null && taskId != null && createdBy != null) {
                    dispatchTask(createdBy, getRunAsUser(runId, createdBy), findTask(taskId, createdBy));
                }
            }
            catch (RuntimeException ignored) {
                // 单条异常不阻断后续定时任务调度。
            }
        }
    }
    private EcosystemRunVo buildPendingRun(Long runId, EcosystemTaskVo task, Long userId) {
        EcosystemRunVo run = new EcosystemRunVo();
        run.setRunId(runId);
        run.setTaskId(task.getTaskId());
        run.setStatus("RUNNING");
        run.setCurrentStep("WAIT_BROWSER_BRIDGE");
        run.setTotalCount(0);
        run.setMarkdownCount(0);
        run.setAssetCount(0);
        run.setFailedCount(0);
        run.setNeedActionType("USER_BROWSER_BRIDGE_RUNNING");
        run.setNeedActionMessage(i18n("ecosystem.bridge.running"));
        run.setStoragePath("ecosystem/users/" + userId + "/runs/" + runId + "/");
        run.setTargetName(task.getTargetName());
        run.setStartedAt(new Date());
        run.setFinishedAt(null);
        run.setSignals(task.getSignals());
        run.setArtifacts(Collections.emptyList());
        run.setSteps(List.of(
            new EcosystemRunVo.StepVo("CONNECT_SOURCE", i18n("ecosystem.step.connect.source"), STATUS_SUCCESS,
                i18n("ecosystem.status.success"), i18n("ecosystem.bridge.task.dispatched")),
            new EcosystemRunVo.StepVo("PULL_RAW", i18n("ecosystem.step.pull.raw"), "RUNNING",
                i18n("ecosystem.status.running"), i18n("ecosystem.bridge.waiting.result")),
            new EcosystemRunVo.StepVo("NORMALIZE_MARKDOWN", i18n("ecosystem.step.normalize.markdown"),
                STATUS_CREATED, i18n("ecosystem.status.pending"), i18n("ecosystem.step.message.wait.raw")),
            new EcosystemRunVo.StepVo("IMPORT_KNOWLEDGE", i18n("ecosystem.step.import.knowledge"),
                STATUS_CREATED, i18n("ecosystem.status.pending"), i18n("ecosystem.step.message.wait.markdown")),
            new EcosystemRunVo.StepVo("BUILD_INDEX", i18n("ecosystem.step.build.index"), STATUS_CREATED,
                i18n("ecosystem.status.pending"), i18n("ecosystem.step.message.wait.import"))
        ));
        return run;
    }
    private void validateBridgeTask(EcosystemTaskVo task) {
        if (!requiresUserBrowserBridge(task.getCollectMode())) {
            throw new IllegalArgumentException(i18n("ecosystem.error.collect.mode.not.executable",
                collectModeName(task.getCollectMode())));
        }
        String sourceUrl = bridgeSourceUrl(task);
        if (requiresSourceUrl(task.getConnectorCode()) && isBlank(sourceUrl)) {
            throw new IllegalArgumentException(i18n("ecosystem.error.web.source.url.required"));
        }
        if (!isHostAllowed(task.getConnectorCode(), sourceUrl)) {
            throw new IllegalArgumentException(i18n("ecosystem.bridge.host.not.allowed", sourceUrl));
        }
    }
    private int dispatchTask(Long userId, EcosystemRunVo run, EcosystemTaskVo task) {
        JSONObject message = new JSONObject();
        message.put("type", MessageType.ECOSYSTEM_BRIDGE.name());
        message.put("event", "TASK");
        message.put("data", taskPayload(run, task));
        return multiDeviceBroadcastService.broadcastRawToUser(userId, message);
    }
    private Map<String, Object> taskPayload(EcosystemRunVo run, EcosystemTaskVo task) {
        return taskPayload(run, task, Collections.emptyMap());
    }
    private Map<String, Object> taskPayload(EcosystemRunVo run, EcosystemTaskVo task,
                                            Map<String, Object> leasePayload) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("protocolVersion", "1.1");
        payload.put("runId", String.valueOf(run.getRunId()));
        payload.put("taskId", String.valueOf(task.getTaskId()));
        payload.put("taskName", task.getTaskName());
        payload.put("connectorCode", task.getConnectorCode());
        String sourceUrl = bridgeSourceUrl(task);
        payload.put("sourceUrl", sourceUrl);
        payload.put("scope", task.getScope());
        payload.put("targetName", task.getTargetName());
        payload.put("collectMode", task.getCollectMode());
        payload.put("allowedHosts", allowedHosts(task.getConnectorCode(), sourceUrl));
        payload.put("lease", leasePayload(leasePayload));
        payload.put("commands", commands(task));
        return payload;
    }
    private List<Map<String, Object>> commands(EcosystemTaskVo task) {
        String sourceUrl = bridgeSourceUrl(task);
        if ("mail".equalsIgnoreCase(task.getConnectorCode())) {
            return mailCommands(task, sourceUrl);
        }
        List<Map<String, Object>> commands = new ArrayList<>();
        commands.add(command("open", Map.of("url", sourceUrl, "target", "tab", "waitUntil", "complete")));
        commands.add(command("waitForReady", Map.of("timeoutMs", 30000, "optional", false)));
        commands.add(command("waitForSelector", Map.of(
            "selector", "article, main, body", "timeoutMs", 15000, "optional", true)));
        commands.add(command("scroll", Map.of(
            "direction", "bottom", "stepPx", 900, "maxSteps", 8, "delayMs", 350, "optional", true)));
        commands.add(command("extract", Map.of(
            "formats", List.of("markdown", "html", "text"),
            "selectors", List.of("article", "main", "body"),
            "includeImages", true)));
        commands.add(command("screenshot", Map.of("scope", "visible", "optional", true)));
        return commands;
    }
    private List<Map<String, Object>> mailCommands(EcosystemTaskVo task, String sourceUrl) {
        List<Map<String, Object>> commands = new ArrayList<>();
        commands.add(command("open", Map.of(
            "url", sourceUrl, "target", "tab", "waitUntil", "complete", "timeoutMs", 45000)));
        commands.add(command("waitForReady", Map.of("timeoutMs", 45000, "optional", false)));
        commands.add(command("waitForSelector", Map.of("selector", "body", "timeoutMs", 20000, "optional", false)));
        commands.add(command("collectMailbox", Map.of(
            "provider", "qqmail",
            "scope", defaultText(task.getScope(), ""),
            "query", mailQuery(task.getScope()),
            "days", mailDays(task.getScope()),
            "maxItems", 30,
            "formats", List.of("markdown", "html", "text"))));
        commands.add(command("screenshot", Map.of("scope", "visible", "optional", true)));
        return commands;
    }
    private String bridgeSourceUrl(EcosystemTaskVo task) {
        String sourceUrl = defaultText(task.getSourceUrl(), "");
        if ("mail".equalsIgnoreCase(task.getConnectorCode()) && !isBrowserUrl(sourceUrl)) {
            return loginUrlForConnector(task.getConnectorCode(), sourceUrl);
        }
        if (isBlank(sourceUrl)) {
            return loginUrlForConnector(task.getConnectorCode(), sourceUrl);
        }
        return sourceUrl;
    }
    private int mailDays(String scope) {
        String text = defaultText(scope, "");
        Matcher matcher = MAIL_DAYS_PATTERN.matcher(text);
        if (matcher.find()) {
            return Math.max(1, Math.min(365, Integer.parseInt(matcher.group(1))));
        }
        if (text.contains("最近一周") || text.contains("近一周")) {
            return 7;
        }
        if (text.contains("最近两周") || text.contains("近两周")) {
            return 14;
        }
        if (text.contains("最近一个月") || text.contains("近一个月")) {
            return 30;
        }
        return 7;
    }
    private String mailQuery(String scope) {
        String text = defaultText(scope, "");
        return text
            .replaceAll("(?:最近|近)\\s*\\d{1,3}\\s*天", " ")
            .replaceAll("最近一周|近一周|最近两周|近两周|最近一个月|近一个月", " ")
            .replaceAll("QQ邮箱|邮箱|收件箱|邮件|采集|同步|关于|的", " ")
            .replaceAll("\\s+", " ")
            .trim();
    }
    private Map<String, Object> command(String action, Map<String, Object> params) {
        Map<String, Object> command = new LinkedHashMap<>();
        command.put("action", action);
        command.putAll(params);
        return command;
    }
    private Map<String, Object> leasePayload(Map<String, Object> leasePayload) {
        Map<String, Object> lease = new LinkedHashMap<>();
        lease.put("required", true);
        lease.put("ttlMs", BROWSER_BRIDGE_LEASE_TTL_MS);
        putIfPresent(lease, "leaseId", stringValue(leasePayload.get("bridgeLeaseId")));
        putIfPresent(lease, "holder", stringValue(leasePayload.get("bridgeLeaseHolder")));
        putIfPresent(lease, "expiresAtMs", leasePayload.get("bridgeLeaseExpiresAtMs"));
        return lease;
    }
    private boolean isLeaseVisibleToClient(Map<String, Object> payload, String bridgeClientId) {
        String leaseId = stringValue(payload.get("bridgeLeaseId"));
        if (isBlank(leaseId)) {
            return true;
        }
        Long expiresAt = longValue(payload.get("bridgeLeaseExpiresAtMs"));
        if (expiresAt == null || expiresAt <= System.currentTimeMillis()) {
            return true;
        }
        return !isBlank(bridgeClientId) && bridgeClientId.equals(stringValue(payload.get("bridgeLeaseHolder")));
    }
    private Map<String, Object> loadRunNeedActionPayload(Long runId, Long userId, boolean forUpdate) {
        String sql = """
            SELECT CAST(r.need_action_payload AS TEXT) AS need_action_payload
              FROM byai.bykc_ec_sync_run r
              JOIN byai.bykc_ec_sync_task t ON t.task_id = r.task_id
             WHERE r.run_id = ? AND t.created_by = ?
            """ + (forUpdate ? " FOR UPDATE" : "");
        List<String> payloads = jdbcTemplate.query(sql, (rs, rowNum) -> rs.getString("need_action_payload"),
            runId, userId);
        if (payloads.isEmpty()) {
            throw new IllegalArgumentException(i18n("ecosystem.error.run.not.found"));
        }
        return new LinkedHashMap<>(fromJson(payloads.get(0), MAP_TYPE, Collections.emptyMap()));
    }
    private void updateRunNeedActionPayload(Long runId, Long userId, String needActionType,
                                            Map<String, Object> payload) {
        jdbcTemplate.update("""
            UPDATE byai.bykc_ec_sync_run
               SET need_action_type = ?, need_action_payload = CAST(? AS JSONB)
             WHERE run_id = ? AND task_id IN (
                   SELECT task_id FROM byai.bykc_ec_sync_task WHERE created_by = ?
             )
            """, needActionType, toJson(payload), runId, userId);
    }
    private Map<String, Object> ensureLease(Long runId, Long userId, Map<String, Object> request) {
        Map<String, Object> payload = loadRunNeedActionPayload(runId, userId, true);
        String requestLeaseId = stringValue(request == null ? null : request.get("leaseId"));
        String storedLeaseId = stringValue(payload.get("bridgeLeaseId"));
        if (isBlank(requestLeaseId) || isBlank(storedLeaseId) || !requestLeaseId.equals(storedLeaseId)) {
            throw new IllegalStateException(i18n("ecosystem.bridge.lease.invalid"));
        }
        Long expiresAt = longValue(payload.get("bridgeLeaseExpiresAtMs"));
        if (expiresAt == null || expiresAt <= System.currentTimeMillis()) {
            throw new IllegalStateException(i18n("ecosystem.bridge.lease.expired"));
        }
        String bridgeClientId = stringValue(request.get("bridgeClientId"));
        if (!isBlank(bridgeClientId) && !bridgeClientId.equals(stringValue(payload.get("bridgeLeaseHolder")))) {
            throw new IllegalStateException(i18n("ecosystem.bridge.lease.invalid"));
        }
        return payload;
    }
    private String requiredBridgeClientId(Map<String, Object> request) {
        String bridgeClientId = stringValue(request == null ? null : request.get("bridgeClientId"));
        if (isBlank(bridgeClientId)) {
            throw new IllegalArgumentException(i18n("ecosystem.bridge.client.required"));
        }
        return bridgeClientId;
    }
    private Map<String, Object> leaseResponse(boolean claimed, Long runId, String leaseId, long expiresAt,
                                              String message, Map<String, Object> taskPayload) {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("claimed", claimed);
        response.put("runId", String.valueOf(runId));
        response.put("message", message);
        response.put("leaseTtlMs", BROWSER_BRIDGE_LEASE_TTL_MS);
        if (!isBlank(leaseId)) {
            response.put("leaseId", leaseId);
        }
        if (expiresAt > 0) {
            response.put("leaseExpiresAtMs", expiresAt);
        }
        if (taskPayload != null) {
            response.put("task", taskPayload);
        }
        return response;
    }
    private OpenCliRunner.CollectionResult buildCollectionResult(EcosystemTaskVo task, Map<String, Object> request) {
        String markdown = normalizeMarkdown(task, request);
        if (isBlank(markdown)) {
            throw new IllegalArgumentException(i18n("ecosystem.error.bridge.result.content.required"));
        }
        String title = defaultText(stringValue(request.get("title")), task.getTaskName());
        String sourceUrl = defaultText(stringValue(request.get("sourceUrl")), task.getSourceUrl());
        BrowserBridgeAssetOutput assetOutput = writeAssets(request);
        OpenCliRunner.CollectionResult result = new OpenCliRunner.CollectionResult();
        result.setCommand(List.of("browser-bridge", "collect", sourceUrl));
        result.setOutputDir(assetOutput.outputDir());
        result.setRawOutput(toJson(Map.of(
            "source", "browserBridge",
            "title", title,
            "sourceUrl", sourceUrl,
            "runId", String.valueOf(request.get("runId")),
            "assetCount", assetOutput.assetCount()
        )));
        result.setItems(List.of(new OpenCliRunner.CollectionItem(
            title,
            sanitizeFileName(title) + ".md",
            sourceUrl,
            markdown)));
        result.setAssetCount(assetOutput.assetCount());
        return result;
    }
    private BrowserBridgeAssetOutput writeAssets(Map<String, Object> request) {
        List<Map<String, Object>> assets = request == null
            ? Collections.emptyList()
            : fromObjectList(request.get("assets"));
        String screenshotDataUrl = stringValue(request == null ? null : request.get("screenshotDataUrl"));
        if (isBlank(screenshotDataUrl) && assets.isEmpty()) {
            return new BrowserBridgeAssetOutput(null, 0);
        }
        try {
            Path outputDir = java.nio.file.Files.createTempDirectory("bykc-browser-bridge-");
            int index = 1;
            if (!isBlank(screenshotDataUrl)) {
                byte[] bytes = decodeDataUrl(screenshotDataUrl);
                if (bytes.length > 0) {
                    java.nio.file.Files.write(outputDir.resolve(String.format("%03d-%s", index++,
                        "browser-bridge-screenshot.png")), bytes);
                }
            }
            for (Map<String, Object> asset : assets) {
                String dataUrl = stringValue(asset.get("dataUrl"));
                if (isBlank(dataUrl)) {
                    continue;
                }
                byte[] bytes = decodeDataUrl(dataUrl);
                if (bytes.length == 0) {
                    continue;
                }
                String fileName = sanitizeFileName(defaultText(stringValue(asset.get("fileName")),
                    "asset-" + index + assetSuffix(stringValue(asset.get("contentType")))));
                java.nio.file.Files.write(outputDir.resolve(String.format("%03d-%s", index++, fileName)), bytes);
            }
            return new BrowserBridgeAssetOutput(outputDir, index - 1);
        }
        catch (Exception e) {
            throw new IllegalArgumentException(i18n("ecosystem.error.bridge.result.asset.invalid"));
        }
    }
    private String normalizeMarkdown(EcosystemTaskVo task, Map<String, Object> request) {
        String body = firstNonBlank(
            stringValue(request.get("markdown")),
            stringValue(request.get("sourceContent")),
            stringValue(request.get("text")));
        if (isBlank(body) && !isBlank(stringValue(request.get("html")))) {
            body = htmlToPlainText(stringValue(request.get("html")));
        }
        if (isBlank(body)) {
            return "";
        }
        String title = defaultText(stringValue(request.get("title")), task.getTaskName());
        String sourceUrl = defaultText(stringValue(request.get("sourceUrl")), task.getSourceUrl());
        return "# " + title + "\n\n"
            + "- " + i18n("ecosystem.markdown.meta.source") + "：" + task.getSourceName() + "\n"
            + "- " + i18n("ecosystem.markdown.meta.link") + "：" + sourceUrl + "\n"
            + "- " + i18n("ecosystem.markdown.meta.collect.mode") + "："
            + i18n("ecosystem.collect.mode.user.browser.bridge") + "\n\n"
            + body.trim() + "\n";
    }
    private void saveRun(EcosystemRunVo run, EcosystemTaskVo task, String triggerType,
                         Map<String, Object> targetConfig) {
        jdbcTemplate.update("""
            INSERT INTO byai.bykc_ec_sync_run (
                run_id, task_id, trigger_type, status, current_step, total_count, markdown_count, asset_count,
                failed_count, need_action_type, need_action_payload, storage_path, started_at, finished_at, create_time
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSONB), ?, ?, ?, ?)
            """,
            run.getRunId(), run.getTaskId(), triggerType, run.getStatus(), run.getCurrentStep(),
            run.getTotalCount(), run.getMarkdownCount(), run.getAssetCount(), run.getFailedCount(),
            run.getNeedActionType(), toJson(needActionPayload(run)), run.getStoragePath(),
            run.getStartedAt(), run.getFinishedAt(), new Date());
        saveRunSteps(run);
        saveRunArtifacts(run, task, targetConfig);
        saveRunSignals(run);
    }
    private void saveRunSteps(EcosystemRunVo run) {
        int order = 1;
        for (EcosystemRunVo.StepVo step : run.getSteps()) {
            jdbcTemplate.update("""
                INSERT INTO byai.bykc_ec_sync_run_step (
                    step_id, run_id, step_code, step_name, status, message, step_order,
                    started_at, finished_at, create_time
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                sequenceService.nextVal(), run.getRunId(), step.getStepCode(), step.getStepName(), step.getStatus(),
                step.getMessage(), order++, run.getStartedAt(), run.getFinishedAt(), new Date());
        }
    }
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
                artifactId, run.getRunId(), artifact.getArtifactType(), artifact.getArtifactName(),
                defaultText(artifact.getSourceUrl(), task.getSourceUrl()), artifact.getArtifactName(),
                "MARKDOWN".equalsIgnoreCase(artifact.getArtifactType()) ? artifact.getStoragePath() : null,
                "RAW".equalsIgnoreCase(artifact.getArtifactType()) ? artifact.getStoragePath() : null,
                "ASSET".equalsIgnoreCase(artifact.getArtifactType()) ? artifact.getStoragePath() : null,
                "MANIFEST".equalsIgnoreCase(artifact.getArtifactType()) ? artifact.getStoragePath() : null,
                artifact.getItemCount(), artifact.getFileId(), artifact.getFileUrl(), artifact.getContentType(),
                artifact.getFileSystemType(), STATUS_SUCCESS, new Date());
            jdbcTemplate.update("""
                INSERT INTO byai.bykc_ec_import_record (
                    import_id, run_id, artifact_id, target_type, target_id, target_path, status, create_time
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                sequenceService.nextVal(), run.getRunId(), artifactId, task.getImportTarget(),
                resolveImportTargetId(task, targetConfig), artifact.getStoragePath(), STATUS_SUCCESS, new Date());
        }
    }
    private void saveRunSignals(EcosystemRunVo run) {
        for (EcosystemSignalVo signal : run.getSignals()) {
            jdbcTemplate.update("""
                INSERT INTO byai.bykc_ec_artifact_signal (
                    signal_id, artifact_id, run_id, signal_type, signal_type_name, signal_code,
                    signal_name, confidence, signal_source, create_time
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                sequenceService.nextVal(), null, run.getRunId(), signal.getSignalType(), signal.getSignalTypeName(),
                signal.getSignalCode(), signal.getSignalName(), signal.getConfidence(), signal.getSource(),
                new Date());
        }
    }
    private EcosystemRunVo buildSuccessRun(Long runId,
                                           EcosystemTaskVo task,
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
        run.setSteps(buildSuccessSteps(task, markdownCount, assetCount, importResult));
        run.setArtifacts(storageResult.getArtifacts());
        return run;
    }
    private EcosystemRunVo buildFailedRun(Long runId,
                                          EcosystemTaskVo task,
                                          Long userId,
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
        run.setStoragePath(storageResult == null ? "ecosystem/users/" + userId + "/runs/" + runId + "/"
            : storageResult.getStoragePath());
        run.setTargetName(task.getTargetName());
        run.setStartedAt(new Date());
        run.setFinishedAt(new Date());
        run.setSignals(task.getSignals());
        run.setSteps(buildFailedSteps(task, exception, storageResult != null));
        run.setArtifacts(storageResult == null ? Collections.emptyList() : storageResult.getArtifacts());
        return run;
    }
    private List<EcosystemRunVo.StepVo> buildSuccessSteps(EcosystemTaskVo task, int markdownCount,
                                                          int assetCount,
                                                          EcosystemKnowledgeImportService.ImportResult importResult) {
        List<EcosystemRunVo.StepVo> steps = new ArrayList<>();
        steps.add(new EcosystemRunVo.StepVo("CONNECT_SOURCE", i18n("ecosystem.step.connect.source"), STATUS_SUCCESS,
            i18n("ecosystem.status.success"), i18n("ecosystem.step.message.connected", task.getSourceName(),
            "USER_BROWSER_BRIDGE")));
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
    private void replaceRun(EcosystemRunVo run, EcosystemTaskVo task, Map<String, Object> targetConfig) {
        jdbcTemplate.update("DELETE FROM byai.bykc_ec_import_record WHERE run_id = ?", run.getRunId());
        jdbcTemplate.update("DELETE FROM byai.bykc_ec_artifact_signal WHERE run_id = ?", run.getRunId());
        jdbcTemplate.update("DELETE FROM byai.bykc_ec_artifact WHERE run_id = ?", run.getRunId());
        jdbcTemplate.update("DELETE FROM byai.bykc_ec_sync_run_step WHERE run_id = ?", run.getRunId());
        jdbcTemplate.update("""
            UPDATE byai.bykc_ec_sync_run
               SET status = ?, current_step = ?, total_count = ?, markdown_count = ?, asset_count = ?,
                   failed_count = ?, need_action_type = ?, need_action_payload = CAST(? AS JSONB),
                   storage_path = ?, started_at = COALESCE(started_at, ?), finished_at = ?
             WHERE run_id = ? AND task_id = ?
            """,
            run.getStatus(), run.getCurrentStep(), run.getTotalCount(), run.getMarkdownCount(), run.getAssetCount(),
            run.getFailedCount(), run.getNeedActionType(), toJson(needActionPayload(run)), run.getStoragePath(),
            run.getStartedAt(), run.getFinishedAt(), run.getRunId(), task.getTaskId());
        saveRunSteps(run);
        saveRunArtifacts(run, task, targetConfig);
        saveRunSignals(run);
    }
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
    private void ensureBridgeRun(EcosystemTaskVo task, Long runId, Long userId) {
        if (!requiresUserBrowserBridge(task.getCollectMode())) {
            throw new IllegalArgumentException(i18n("ecosystem.error.collect.mode.not.executable",
                collectModeName(task.getCollectMode())));
        }
        EcosystemRunVo run = getRunAsUser(runId, userId);
        if (!"RUNNING".equalsIgnoreCase(run.getStatus())) {
            throw new IllegalStateException(i18n("ecosystem.bridge.run.not.running"));
        }
    }
    private Long requireRunId(Map<String, Object> request) {
        Long runId = longValue(request == null ? null : request.get("runId"));
        if (runId == null) {
            throw new IllegalArgumentException(i18n("ecosystem.error.run.id.empty"));
        }
        return runId;
    }
    private Long findRunTaskId(Long runId, Long userId) {
        List<Long> taskIds = jdbcTemplate.query("""
            SELECT r.task_id
              FROM byai.bykc_ec_sync_run r
              JOIN byai.bykc_ec_sync_task t ON t.task_id = r.task_id
             WHERE r.run_id = ? AND t.created_by = ?
            """, (rs, rowNum) -> rs.getLong("task_id"), runId, userId);
        if (taskIds.isEmpty()) {
            throw new IllegalArgumentException(i18n("ecosystem.error.run.not.found"));
        }
        return taskIds.get(0);
    }
    private EcosystemTaskVo findTask(Long taskId, Long userId) {
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
    private Map<String, Object> findTaskTargetConfig(Long taskId, Long userId) {
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
    private RowMapper<EcosystemTaskVo> taskRowMapper() {
        return (rs, rowNum) -> {
            Map<String, Object> scopeConfig = fromJson(rs.getString("scope_config"), MAP_TYPE, Collections.emptyMap());
            Map<String, Object> targetConfig = fromJson(rs.getString("target_config"), MAP_TYPE, Collections.emptyMap());
            Map<String, Object> options = fromJson(rs.getString("options"), MAP_TYPE, Collections.emptyMap());
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
            task.setSourceName(firstNonBlank(rs.getString("connector_name"), stringValue(options.get("connectorName")),
                rs.getString("connector_code")));
            task.setSourceUrl(defaultText(rs.getString("source_url"), text(scopeConfig, "sourceUrl", "-")));
            task.setScope(text(scopeConfig, "scope", i18n("ecosystem.scope.recent")));
            task.setOwnerType(rs.getString("owner_type"));
            task.setRunLocation(rs.getString("run_location"));
            task.setCollectMode(defaultText(stringValue(options.get("collectMode")),
                collectModeFromRunLocation(task.getRunLocation())));
            task.setOptions(options);
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
    private List<EcosystemRunVo.ArtifactVo> listRunArtifacts(Long runId) {
        return jdbcTemplate.query("""
            SELECT artifact_type, artifact_name, markdown_path, raw_path, asset_dir, manifest_path, item_count,
                   file_id, file_url, content_type, file_system_type, source_url
              FROM byai.bykc_ec_artifact
             WHERE run_id = ?
             ORDER BY artifact_id
            """, (rs, rowNum) -> {
            EcosystemRunVo.ArtifactVo artifact = new EcosystemRunVo.ArtifactVo(
                rs.getString("artifact_type"), rs.getString("artifact_name"), artifactStoragePath(rs),
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
    private List<EcosystemSignalVo> listRunSignals(Long runId) {
        return jdbcTemplate.query("""
            SELECT signal_type, signal_type_name, signal_code, signal_name, confidence, signal_source
              FROM byai.bykc_ec_artifact_signal
             WHERE run_id = ?
             ORDER BY signal_type, signal_code
            """, signalRowMapper(), runId);
    }
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
    private boolean isHostAllowed(String connectorCode, String sourceUrl) {
        String host = sourceHost(sourceUrl);
        if (isBlank(host)) {
            return !requiresSourceUrl(connectorCode);
        }
        return allowedHosts(connectorCode, sourceUrl).stream().anyMatch(allowed -> hostMatches(host, allowed));
    }
    private List<String> allowedHosts(String connectorCode, String sourceUrl) {
        List<String> hosts = new ArrayList<>();
        String host = sourceHost(sourceUrl);
        if (!isBlank(host)) {
            hosts.add(host);
        }
        if ("zhihu".equalsIgnoreCase(connectorCode)) {
            hosts.add("zhihu.com");
            hosts.add("zhuanlan.zhihu.com");
            hosts.add("www.zhihu.com");
        }
        else if ("dingtalk".equalsIgnoreCase(connectorCode)) {
            hosts.add("dingtalk.com");
            hosts.add("im.dingtalk.com");
        }
        else if ("mail".equalsIgnoreCase(connectorCode)) {
            hosts.add("mail.qq.com");
            hosts.add("wx.mail.qq.com");
            hosts.add("exmail.qq.com");
            hosts.add("mail.tencent.com");
        }
        else if ("web".equalsIgnoreCase(connectorCode) && !isBlank(host)) {
            hosts.add(host);
        }
        hosts.addAll(openCliCapabilityService.domains(connectorCode));
        return hosts.stream().filter(item -> !isBlank(item)).distinct().toList();
    }
    private String sourceHost(String sourceUrl) {
        if (isBlank(sourceUrl)) {
            return "";
        }
        try {
            String host = URI.create(sourceUrl).getHost();
            return host == null ? "" : host.toLowerCase(Locale.ROOT);
        }
        catch (IllegalArgumentException e) {
            return "";
        }
    }
    private boolean hostMatches(String host, String allowedHost) {
        if (isBlank(host) || isBlank(allowedHost)) {
            return false;
        }
        String normalizedHost = host.toLowerCase(Locale.ROOT);
        String normalizedAllowedHost = allowedHost.toLowerCase(Locale.ROOT);
        return normalizedHost.equals(normalizedAllowedHost) || normalizedHost.endsWith("." + normalizedAllowedHost);
    }
    private Map<String, Object> needActionPayload(EcosystemRunVo run) {
        Map<String, Object> payload = new LinkedHashMap<>();
        putIfPresent(payload, "message", run.getNeedActionMessage());
        putIfPresent(payload, "needActionType", run.getNeedActionType());
        return payload;
    }
    private String resolveNeedActionType(RuntimeException exception) {
        if (exception instanceof OpenCliRunner.OpenCliException openCliException) {
            return openCliException.getNeedActionType();
        }
        String message = defaultText(exception.getMessage(), "").toLowerCase(Locale.ROOT);
        if (message.contains("登录") || message.contains("login") || message.contains("sign in")) {
            return "LOGIN_REQUIRED";
        }
        return "RUN_FAILED";
    }
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
    private Map<String, Object> withNextRunTime(Map<String, Object> scheduleConfig, Date nextRunTime) {
        Map<String, Object> config = new LinkedHashMap<>(defaultMap(scheduleConfig));
        if (nextRunTime == null) {
            config.remove("nextRunTime");
            return config;
        }
        config.put("nextRunTime", nextRunTime.toInstant().toString());
        return config;
    }
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
    private byte[] decodeDataUrl(String dataUrl) {
        int commaIndex = dataUrl == null ? -1 : dataUrl.indexOf(',');
        if (commaIndex < 0) {
            return new byte[0];
        }
        return Base64.getDecoder().decode(dataUrl.substring(commaIndex + 1));
    }
    private String assetSuffix(String contentType) {
        if (contentType == null) {
            return ".bin";
        }
        String normalized = contentType.toLowerCase(Locale.ROOT);
        if (normalized.contains("png")) {
            return ".png";
        }
        if (normalized.contains("jpeg") || normalized.contains("jpg")) {
            return ".jpg";
        }
        if (normalized.contains("pdf")) {
            return ".pdf";
        }
        return ".bin";
    }
    private String htmlToPlainText(String html) {
        return html.replaceAll("(?is)<script[^>]*>.*?</script>", " ")
            .replaceAll("(?is)<style[^>]*>.*?</style>", " ")
            .replaceAll("(?is)<br\\s*/?>", "\n")
            .replaceAll("(?is)</p>", "\n\n")
            .replaceAll("(?is)<[^>]+>", " ")
            .replace("&nbsp;", " ")
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replaceAll("[ \\t\\x0B\\f\\r]+", " ")
            .replaceAll("\\n{3,}", "\n\n")
            .trim();
    }
    private String loginUrlForConnector(String connectorCode, String sourceUrl) {
        if ("zhihu".equalsIgnoreCase(connectorCode)) {
            return "https://www.zhihu.com/signin";
        }
        if ("github".equalsIgnoreCase(connectorCode)) {
            return "https://github.com/login";
        }
        if ("dingtalk".equalsIgnoreCase(connectorCode)) {
            return "https://login.dingtalk.com/";
        }
        if ("mail".equalsIgnoreCase(connectorCode)) {
            return isBrowserUrl(sourceUrl) ? sourceUrl : "https://mail.qq.com/";
        }
        return firstNonBlank(sourceUrl, openCliCapabilityService.defaultSiteUrl(connectorCode), "about:blank");
    }
    private boolean isBrowserUrl(String sourceUrl) {
        if (isBlank(sourceUrl)) {
            return false;
        }
        try {
            String scheme = URI.create(sourceUrl).getScheme();
            return "http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme);
        }
        catch (IllegalArgumentException e) {
            return false;
        }
    }
    private boolean requiresSourceUrl(String connectorCode) {
        return "web".equalsIgnoreCase(connectorCode);
    }
    private boolean requiresUserBrowserBridge(String collectMode) {
        return COLLECT_MODE_USER_BROWSER_BRIDGE.equalsIgnoreCase(collectMode);
    }
    private String collectModeFromRunLocation(String runLocation) {
        return "LOCAL".equalsIgnoreCase(runLocation) ? COLLECT_MODE_USER_BROWSER_BRIDGE : COLLECT_MODE_SERVER_OPENCLI;
    }
    private String collectModeName(String collectMode) {
        if (COLLECT_MODE_SERVER_OPENCLI.equalsIgnoreCase(collectMode)) {
            return i18n("ecosystem.collect.mode.server.opencli");
        }
        if (COLLECT_MODE_USER_BROWSER_BRIDGE.equalsIgnoreCase(collectMode)) {
            return i18n("ecosystem.collect.mode.user.browser.bridge");
        }
        return defaultText(collectMode, "-");
    }
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
        return defaultText(status, "-");
    }
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
    private String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        }
        catch (JsonProcessingException e) {
            throw new IllegalArgumentException(i18n("ecosystem.error.json.serialize"), e);
        }
    }
    private Map<String, Object> defaultMap(Map<String, Object> value) {
        return value == null ? Collections.emptyMap() : value;
    }
    private List<Map<String, Object>> fromObjectList(Object value) {
        if (value == null) {
            return Collections.emptyList();
        }
        if (value instanceof List<?> list) {
            List<Map<String, Object>> maps = new ArrayList<>();
            for (Object item : list) {
                if (item instanceof Map<?, ?> map) {
                    maps.add(objectMap(map));
                }
            }
            return maps;
        }
        if (value instanceof String text) {
            return fromJson(text, MAP_LIST_TYPE, Collections.emptyList());
        }
        return Collections.emptyList();
    }
    private Map<String, Object> objectMap(Map<?, ?> value) {
        Map<String, Object> map = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : value.entrySet()) {
            if (entry.getKey() != null) {
                map.put(String.valueOf(entry.getKey()), entry.getValue());
            }
        }
        return map;
    }
    private void putIfPresent(Map<String, Object> target, String key, Object value) {
        if (value != null) {
            target.put(key, value);
        }
    }
    private void putIfPresent(Map<String, Object> target, String key, String value) {
        if (!isBlank(value)) {
            target.put(key, value);
        }
    }
    private String text(Map<String, Object> values, String key, String defaultValue) {
        Object value = values == null ? null : values.get(key);
        return value == null ? defaultValue : String.valueOf(value);
    }
    private Date toDate(Timestamp timestamp) {
        return timestamp == null ? null : new Date(timestamp.getTime());
    }
    private String firstNonBlank(String... values) {
        for (String value : values) {
            if (!isBlank(value)) {
                return value.trim();
            }
        }
        return "";
    }
    private String stringValue(Object value) {
        return value == null ? null : String.valueOf(value);
    }
    private Long longValue(Object value) {
        if (value == null || isBlank(String.valueOf(value))) {
            return null;
        }
        if (value instanceof Number number) {
            return number.longValue();
        }
        return Long.valueOf(String.valueOf(value));
    }
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
    private String defaultText(String value, String defaultValue) {
        return isBlank(value) ? defaultValue : value.trim();
    }
    private String i18n(String key, Object... args) {
        return I18nUtil.get(key, args);
    }
    private String sanitizeFileName(String value) {
        String fileName = defaultText(value, i18n("ecosystem.collection.item.file.name"))
            .replaceAll("[\\\\/:*?\"<>|]+", "_").trim();
        if (fileName.length() > 80) {
            fileName = fileName.substring(0, 80);
        }
        return fileName;
    }
    private String abbreviate(String value, int maxLength) {
        if (value == null || value.length() <= maxLength) {
            return value;
        }
        return value.substring(0, maxLength) + "...";
    }
    private boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }
    private record BrowserBridgeAssetOutput(Path outputDir, int assetCount) {
    }
}
