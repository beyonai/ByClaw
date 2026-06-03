package com.iwhalecloud.byai.manager.application.service.ecosystem;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
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
import com.iwhalecloud.byai.manager.dto.ecosystem.EcosystemAgentHeartbeatRequest;
import com.iwhalecloud.byai.manager.dto.ecosystem.EcosystemTaskCreateRequest;
import com.iwhalecloud.byai.manager.vo.ecosystem.EcosystemAgentStatusVo;
import com.iwhalecloud.byai.manager.vo.ecosystem.EcosystemConnectorVo;
import com.iwhalecloud.byai.manager.vo.ecosystem.EcosystemRunVo;
import com.iwhalecloud.byai.manager.vo.ecosystem.EcosystemSignalVo;
import com.iwhalecloud.byai.manager.vo.ecosystem.EcosystemTaskVo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * 生态采集服务共用支撑能力。
 *
 * @author qin.guoquan
 * @date 2026-05-29 21:12:18
 */
abstract class EcosystemCollectionSupport {

    protected static final String STATUS_CREATED = "CREATED";
    protected static final String STATUS_SUCCESS = "SUCCESS";
    protected static final String STATUS_FAILED = "FAILED";
    protected static final String STATUS_SKIPPED = "SKIPPED";
    protected static final String STATUS_DISABLED = "DISABLED";
    protected static final String STATUS_ARCHIVED = "ARCHIVED";
    protected static final String STATUS_AUTHORIZING = "AUTHORIZING";
    protected static final String STATUS_NEED_AUTH = "NEED_AUTH";
    protected static final String STATUS_READY = "READY";
    protected static final String STATUS_EXPIRED = "EXPIRED";
    protected static final String COLLECT_MODE_SERVER_OPENCLI = "SERVER_OPENCLI";
    protected static final String COLLECT_MODE_USER_BROWSER_BRIDGE = "USER_BROWSER_BRIDGE";
    protected static final long COLLECTOR_AGENT_HEARTBEAT_TTL_MS = 45_000L;

    protected static final TypeReference<List<String>> STRING_LIST_TYPE = new TypeReference<>() {
    };
    protected static final TypeReference<List<EcosystemSignalVo>> SIGNAL_LIST_TYPE = new TypeReference<>() {
    };
    protected static final TypeReference<List<EcosystemAgentStatusVo.SiteSessionVo>> SITE_SESSION_LIST_TYPE =
        new TypeReference<>() {
        };
    protected static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {
    };
    protected static final TypeReference<List<Map<String, Object>>> MAP_LIST_TYPE = new TypeReference<>() {
    };

    @Autowired
    protected JdbcTemplate jdbcTemplate;

    @Autowired
    protected ObjectMapper objectMapper;
    /**
     * 浏览器登录态能力状态表行映射。
     */
    protected RowMapper<EcosystemAgentStatusVo> agentStatusRowMapper() {
        return (rs, rowNum) -> {
            EcosystemAgentStatusVo status = new EcosystemAgentStatusVo();
            String agentStatus = rs.getString("status");
            Timestamp lastHeartbeat = rs.getTimestamp("last_heartbeat_time");
            boolean connected = "ONLINE".equalsIgnoreCase(agentStatus) && isAgentHeartbeatFresh(lastHeartbeat);
            status.setConnected(connected);
            status.setAgentName(rs.getString("agent_name"));
            status.setRuntimeName(rs.getString("runtime_name"));
            status.setRuntimeVersion(rs.getString("runtime_version"));
            status.setBrowserBridgeStatus(connected
                ? rs.getString("browser_bridge_status")
                : i18n("ecosystem.browser.bridge.disconnected"));
            status.setChromeProfile(rs.getString("chrome_profile"));
            status.setLastHeartbeatTime(toDate(lastHeartbeat));
            status.setSiteSessions(fromJson(rs.getString("site_sessions"), SITE_SESSION_LIST_TYPE,
                Collections.emptyList()));
            return status;
        };
    }

    /**
     * 采集任务表行映射，包含最近一次运行摘要。
     */
    protected RowMapper<EcosystemTaskVo> taskRowMapper() {
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
            Map<String, Object> options = fromJson(rs.getString("options"), MAP_TYPE, Collections.emptyMap());
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

    /**
     * 连接配置表行映射，返回安全视图。
     */
    protected RowMapper<Map<String, Object>> connectionRowMapper() {
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
     * 构造对外返回的安全凭据视图，不返回明文 Token。
     */
    protected Map<String, Object> safeCredentialConfig(Map<String, Object> credentialConfig) {
        Map<String, Object> safeConfig = new LinkedHashMap<>();
        boolean hasToken = credentialConfig.containsKey("token")
            || Boolean.TRUE.equals(credentialConfig.get("tokenConfigured"));
        safeConfig.put("hasToken", hasToken);
        putIfPresent(safeConfig, "tokenLast4", stringValue(credentialConfig.get("tokenLast4")));
        putIfPresent(safeConfig, "account", stringValue(credentialConfig.get("account")));
        putIfPresent(safeConfig, "imapHost", stringValue(credentialConfig.get("imapHost")));
        putIfPresent(safeConfig, "imapPort", credentialConfig.get("imapPort"));
        putIfPresent(safeConfig, "imapSsl", credentialConfig.get("imapSsl"));
        putIfPresent(safeConfig, "imapFolder", stringValue(credentialConfig.get("imapFolder")));
        putIfPresent(safeConfig, "oauthProvider", stringValue(credentialConfig.get("oauthProvider")));
        return safeConfig;
    }

    /**
     * 采集运行表行映射。
     */
    protected RowMapper<EcosystemRunVo> runRowMapper() {
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
    protected RowMapper<EcosystemSignalVo> signalRowMapper() {
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
     * 构造未连接 Browser Bridge 时的默认离线状态。
     */
    protected EcosystemAgentStatusVo offlineAgentStatus() {
        EcosystemAgentStatusVo status = new EcosystemAgentStatusVo();
        status.setConnected(Boolean.FALSE);
        status.setAgentName(i18n("ecosystem.browser.bridge.name", defaultUserName()));
        status.setRuntimeName("ByClaw Browser Bridge");
        status.setRuntimeVersion("-");
        status.setBrowserBridgeStatus(i18n("ecosystem.browser.bridge.disconnected"));
        status.setChromeProfile("-");
        status.setSiteSessions(Collections.emptyList());
        return status;
    }

    /**
     * 判断 Browser Bridge 心跳是否仍在有效窗口内。
     */
    protected boolean isAgentHeartbeatFresh(Timestamp lastHeartbeat) {
        return lastHeartbeat != null
            && System.currentTimeMillis() - lastHeartbeat.getTime() <= COLLECTOR_AGENT_HEARTBEAT_TTL_MS;
    }

    /**
     * 构造任务采集范围配置，写入 bykc_ec_sync_task.scope_config。
     */
    protected Map<String, Object> buildScopeConfig(EcosystemTaskCreateRequest request, EcosystemTaskVo task) {
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
    protected Map<String, Object> buildTargetConfig(EcosystemTaskCreateRequest request, EcosystemTaskVo task) {
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
    protected Map<String, Object> buildScheduleConfig(EcosystemTaskCreateRequest request, String scheduleType) {
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
    protected Map<String, Object> withNextRunTime(Map<String, Object> scheduleConfig, Date nextRunTime) {
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
    protected Date resolveNextRunTime(String scheduleType, Map<String, Object> scheduleConfig, Date baseTime) {
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
    protected void putObjectSignal(Map<String, EcosystemSignalVo> signals, String code, String typeName, String value) {
        if (isBlank(value)) {
            return;
        }
        putSignal(signals, "object", i18n("ecosystem.signal.type.object"), code,
            i18n("ecosystem.signal.name.object", typeName, value.trim()), 0.9, "user");
    }

    /**
     * 写入信号 Map，同类型同编码自动去重。
     */
    protected void putSignal(Map<String, EcosystemSignalVo> signals, String type, String typeName, String code,
                           String name, double confidence, String source) {
        signals.put(type + ":" + code, new EcosystemSignalVo(type, typeName, code, name, confidence, source));
    }

    /**
     * 根据采集范围文本推断内容类型信号。
     */
    protected String resolveContentSignal(String scope) {
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
    protected String resolvePrivacyCode(EcosystemTaskCreateRequest request) {
        return "enterprise".equalsIgnoreCase(request.getOwnerType()) ? "enterprise_candidate" : "personal";
    }

    /**
     * 根据归属类型推断隐私信号名称。
     */
    protected String resolvePrivacyName(EcosystemTaskCreateRequest request) {
        return "enterprise".equalsIgnoreCase(request.getOwnerType()) ? i18n("ecosystem.privacy.enterprise.candidate")
            : i18n("ecosystem.privacy.personal");
    }

    /**
     * 解析入库目标展示名称。
     */
    protected String resolveTargetName(EcosystemTaskCreateRequest request) {
        String knowledgeBase = defaultText(request.getKnowledgeBaseName(),
            defaultText(request.getKnowledgeBaseId(), i18n("ecosystem.default.knowledge.base")));
        return i18n("ecosystem.target.personal.knowledge.base", knowledgeBase);
    }

    /**
     * 校验任务创建请求。
     */
    protected void validateTaskCreateRequest(EcosystemTaskCreateRequest request) {
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
    protected String normalizeTaskStatus(String status) {
        String value = defaultText(status, STATUS_CREATED).toUpperCase(Locale.ROOT);
        if (STATUS_CREATED.equals(value) || STATUS_DISABLED.equals(value) || STATUS_ARCHIVED.equals(value)) {
            return value;
        }
        throw new IllegalArgumentException(i18n("ecosystem.error.task.status.unsupported", status));
    }

    /**
     * 按连接器给出预估输出数量，保留给列表摘要和后续统计兜底。
     */
    protected int outputCount(String connectorCode) {
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
    protected int failedCount(String connectorCode) {
        return "mail".equalsIgnoreCase(connectorCode) ? 1 : 0;
    }

    /**
     * 从产物行中解析最合适的存储路径字段。
     */
    protected String artifactStoragePath(ResultSet rs) throws SQLException {
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
    protected List<String> capabilities(Map<String, Object> capabilitySchema) {
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
    protected Map<String, Object> defaultMap(Map<String, Object> value) {
        return value == null ? Collections.emptyMap() : value;
    }

    /**
     * 将任意对象安全转为 Map，主要用于读取 JSONB 反序列化后的嵌套配置。
     */
    protected Map<String, Object> defaultMapMap(Object value) {
        if (value instanceof Map<?, ?> map) {
            return objectMap(map);
        }
        return Collections.emptyMap();
    }

    /**
     * 将 JSONB/前端请求中的对象列表转成 String key 的 Map 列表。
     */
    protected List<Map<String, Object>> fromObjectList(Object value) {
        if (value == null) {
            return Collections.emptyList();
        }
        if (value instanceof String text) {
            return fromJson(text, MAP_LIST_TYPE, Collections.emptyList());
        }
        if (value instanceof List<?> list) {
            List<Map<String, Object>> result = new ArrayList<>();
            for (Object item : list) {
                if (item instanceof Map<?, ?> map) {
                    result.add(objectMap(map));
                }
            }
            return result;
        }
        return Collections.emptyList();
    }

    /**
     * 将任意 key 类型的 Map 转为 String key 的 Map。
     */
    protected Map<String, Object> objectMap(Map<?, ?> value) {
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
    protected List<String> stringList(Object value) {
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
    protected List<EcosystemAgentStatusVo.SiteSessionVo> defaultSiteSessions(
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
    protected Map<String, Object> needActionPayload(EcosystemRunVo run) {
        Map<String, Object> payload = new LinkedHashMap<>();
        putIfPresent(payload, "message", run.getNeedActionMessage());
        putIfPresent(payload, "needActionType", run.getNeedActionType());
        return payload;
    }

    /**
     * 根据异常类型解析需要用户处理的动作类型。
     */
    protected String resolveNeedActionType(RuntimeException exception) {
        if (exception instanceof OpenCliRunner.OpenCliException openCliException) {
            return openCliException.getNeedActionType();
        }
        return "RUN_FAILED";
    }

    /**
     * 生成运行失败提示，OpenCLI 错误会拼接截断后的命令输出。
     */
    protected String resolveNeedActionMessage(RuntimeException exception) {
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
    protected void putIfPresent(Map<String, Object> target, String key, Object value) {
        if (value != null && !isBlank(String.valueOf(value))) {
            target.put(key, value);
        }
    }

    /**
     * 当字符串不为空时写入 Map，并去掉前后空白。
     */
    protected void putIfPresent(Map<String, Object> target, String key, String value) {
        if (!isBlank(value)) {
            target.put(key, value.trim());
        }
    }

    /**
     * 从 Map 中取字符串，空值时返回默认值。
     */
    protected String text(Map<String, Object> values, String key, String defaultValue) {
        Object value = values.get(key);
        return value == null ? defaultValue : String.valueOf(value);
    }

    /**
     * JSON 反序列化，空值返回默认值。
     */
    protected <T> T fromJson(String json, TypeReference<T> typeReference, T defaultValue) {
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
    protected String toJson(Object value) {
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
    protected Date toDate(Timestamp timestamp) {
        return timestamp == null ? null : new Date(timestamp.getTime());
    }

    /**
     * 运行/任务状态编码转展示名称。
     */
    protected String statusName(String status) {
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
    protected String scheduleTypeName(String scheduleType) {
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
    protected String connectionStatusName(String status) {
        if (STATUS_READY.equalsIgnoreCase(status)) {
            return i18n("ecosystem.connection.status.ready");
        }
        if (STATUS_AUTHORIZING.equalsIgnoreCase(status)) {
            return i18n("ecosystem.connection.status.authorizing");
        }
        if (STATUS_NEED_AUTH.equalsIgnoreCase(status)) {
            return i18n("ecosystem.connection.status.need.auth");
        }
        if (STATUS_EXPIRED.equalsIgnoreCase(status)) {
            return i18n("ecosystem.connection.status.expired");
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
     * 根据连接器声明的运行位置和认证方式，推导面向产品的采集模式。OpenCLI 始终是平台侧内置执行器；
     * 需要用户登录态的网站统一走 Browser Bridge，不再暴露平台托管浏览器和当前页直传两套旧入口。
     */
    protected List<String> collectModes(List<String> runLocations, List<String> authTypes) {
        List<String> modes = new ArrayList<>();
        if (containsIgnoreCase(runLocations, "SERVER") && hasServerCredentialAuth(authTypes)) {
            modes.add(COLLECT_MODE_SERVER_OPENCLI);
        }
        if (containsIgnoreCase(authTypes, "BROWSER")) {
            modes.add(COLLECT_MODE_USER_BROWSER_BRIDGE);
        }
        if (modes.isEmpty() && containsIgnoreCase(runLocations, "SERVER")) {
            modes.add(COLLECT_MODE_SERVER_OPENCLI);
        }
        if (modes.isEmpty() && containsIgnoreCase(runLocations, "LOCAL")) {
            modes.add(COLLECT_MODE_USER_BROWSER_BRIDGE);
        }
        return modes;
    }

    /**
     * PUBLIC_URL、TOKEN、OAUTH、IMAP 都可以在平台侧执行，不需要用户侧浏览器 Bridge。
     */
    protected boolean hasServerCredentialAuth(List<String> authTypes) {
        return containsIgnoreCase(authTypes, "PUBLIC_URL") || containsIgnoreCase(authTypes, "TOKEN")
            || containsIgnoreCase(authTypes, "OAUTH") || containsIgnoreCase(authTypes, "IMAP");
    }

    /**
     * 规范化采集模式；未传时使用连接器默认模式。需要登录态的连接器默认走用户浏览器桥接。
     */
    protected String normalizeCollectMode(String collectMode, EcosystemConnectorVo connector) {
        List<String> modes = connector.getCollectModes() == null ? Collections.emptyList() : connector.getCollectModes();
        if (!isBlank(collectMode) && containsIgnoreCase(modes, collectMode)) {
            return collectMode.toUpperCase(Locale.ROOT);
        }
        if ("mail".equalsIgnoreCase(connector.getConnectorCode())
            && COLLECT_MODE_USER_BROWSER_BRIDGE.equalsIgnoreCase(collectMode)) {
            // 邮箱对话入口优先支持 QQ 邮箱网页版采集；即便存量连接器行尚未刷新 BROWSER 能力，也允许走 Bridge。
            return COLLECT_MODE_USER_BROWSER_BRIDGE;
        }
        if (!isBlank(connector.getDefaultCollectMode())) {
            return connector.getDefaultCollectMode();
        }
        return firstOrDefault(modes, COLLECT_MODE_SERVER_OPENCLI);
    }

    /**
     * 根据采集模式推导默认认证方式。
     */
    protected String defaultAuthType(EcosystemConnectorVo connector, String collectMode) {
        if (requiresBrowserAuth(collectMode)) {
            return "BROWSER";
        }
        List<String> authTypes = connector.getAuthTypes() == null ? Collections.emptyList() : connector.getAuthTypes();
        for (String authType : authTypes) {
            if (!"BROWSER".equalsIgnoreCase(authType)) {
                return authType;
            }
        }
        return firstOrDefault(authTypes, "PUBLIC_URL");
    }

    /**
     * 根据采集模式推导旧字段 runLocation，保持存量表结构兼容。
     */
    protected String defaultRunLocation(String collectMode) {
        return requiresUserBrowserBridge(collectMode) ? "LOCAL" : "SERVER";
    }

    /**
     * 旧任务没有 collectMode 时，根据 runLocation 做兼容回填。LOCAL 统一回填为 Browser Bridge。
     */
    protected String collectModeFromRunLocation(String runLocation) {
        return "LOCAL".equalsIgnoreCase(runLocation) ? COLLECT_MODE_USER_BROWSER_BRIDGE : COLLECT_MODE_SERVER_OPENCLI;
    }

    /**
     * 判断采集模式是否需要浏览器登录态。
     */
    protected boolean requiresBrowserAuth(String collectMode) {
        return COLLECT_MODE_USER_BROWSER_BRIDGE.equalsIgnoreCase(collectMode);
    }

    /**
     * 仅 Browser Bridge 长连接模式需要用户侧桥接在线；服务端托管浏览器不要求用户安装 OpenCLI。
     */
    protected boolean requiresUserBrowserBridge(String collectMode) {
        return COLLECT_MODE_USER_BROWSER_BRIDGE.equalsIgnoreCase(collectMode);
    }

    /**
     * 当前已接入真实执行链路的是平台侧 OpenCLI；Browser Bridge 由主流程提前分派。
     */
    protected boolean isExecutableCollectMode(String collectMode) {
        return COLLECT_MODE_SERVER_OPENCLI.equalsIgnoreCase(collectMode);
    }

    /**
     * 采集模式编码转展示名称。
     */
    protected String collectModeName(String collectMode) {
        if (COLLECT_MODE_SERVER_OPENCLI.equalsIgnoreCase(collectMode)) {
            return i18n("ecosystem.collect.mode.server.opencli");
        }
        if (COLLECT_MODE_USER_BROWSER_BRIDGE.equalsIgnoreCase(collectMode)) {
            return i18n("ecosystem.collect.mode.user.browser.bridge");
        }
        return defaultText(collectMode, "-");
    }

    /**
     * 认证方式编码转展示名称。
     */
    protected String authTypeName(String authType) {
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
    protected String runLocationName(String runLocation) {
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
    protected boolean containsIgnoreCase(List<String> values, String expected) {
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
    protected Long currentUserId() {
        return CurrentUserHolder.getCurrentUserId();
    }

    /**
     * 空文本兜底。
     */
    protected String defaultText(String value, String defaultValue) {
        return isBlank(value) ? defaultValue : value.trim();
    }

    /**
     * 获取国际化文案。
     */
    protected String i18n(String key, Object... args) {
        return I18nUtil.get(key, args);
    }

    /**
     * 当前登录用户编码，调度场景没有登录态时使用 anonymous。
     */
    protected String defaultUserCode() {
        return defaultText(CurrentUserHolder.getCurrentUserCode(), "anonymous");
    }

    /**
     * 当前登录用户名称，调度场景没有登录态时使用默认文案。
     */
    protected String defaultUserName() {
        return defaultText(CurrentUserHolder.getCurrentUserName(), i18n("ecosystem.current.user"));
    }

    /**
     * 返回列表首个值，列表为空时返回默认值。
     */
    protected String firstOrDefault(List<String> values, String defaultValue) {
        return values == null || values.isEmpty() ? defaultValue : values.get(0);
    }

    /**
     * 返回第一个非空文本。
     */
    protected String firstNonBlank(String... values) {
        for (String value : values) {
            if (!isBlank(value)) {
                return value.trim();
            }
        }
        return "";
    }

    /**
     * 对象转字符串，保留 null 语义。
     */
    protected String stringValue(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    /**
     * 对象转 Long，空值返回 null。
     */
    protected Long longValue(Object value) {
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
    protected int intValue(Object value, int defaultValue) {
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
    protected DayOfWeek dayOfWeekValue(Object value) {
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
    protected String last4(String value) {
        String text = defaultText(value, "");
        if (text.length() <= 4) {
            return text;
        }
        return text.substring(text.length() - 4);
    }

    /**
     * 将信号名称规范化为可检索、可去重的编码。
     */
    protected String normalizeCode(String value) {
        if (value == null) {
            return "unknown";
        }
        return value.trim().toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9\\u4e00-\\u9fa5]+", "_");
    }

    /**
     * 规范化采集产物文件名，避免非法字符和超长标题影响对象存储。
     */
    protected String sanitizeFileName(String value) {
        String fileName = defaultText(value, i18n("ecosystem.collection.item.file.name"))
            .replaceAll("[\\\\/:*?\"<>|]+", "_").trim();
        if (fileName.length() > 80) {
            fileName = fileName.substring(0, 80);
        }
        return fileName;
    }

    /**
     * 截断长文本，用于错误信息和命令输出摘要。
     */
    protected String abbreviate(String value, int maxLength) {
        if (value == null || value.length() <= maxLength) {
            return value;
        }
        return value.substring(0, maxLength) + "...";
    }

    /**
     * 判断文本是否为空。
     */
    protected boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }

    /**
     * 判断计划是否包含指定缺失动作。
     */
    protected boolean hasMissingAction(Map<String, Object> plan, String... candidates) {
        List<String> actions = stringList(plan.get("missingActions"));
        for (String candidate : candidates) {
            if (containsIgnoreCase(actions, candidate)) {
                return true;
            }
        }
        return false;
    }

    /**
     * QQ/网页邮箱的对话入口默认走本机 Browser Bridge，IMAP 仅在用户明确提到时启用。
     */
    protected boolean isExplicitImapRequest(Map<String, Object> input) {
        String rawText = defaultText(stringValue(input.get("originalText")), stringValue(input.get("text")));
        String value = rawText.toLowerCase(Locale.ROOT);
        return value.contains("imap") || value.contains("授权码") || value.contains("邮箱授权")
            || value.contains("授权密码") || value.contains("客户端密码");
    }

    /**
     * 判断当前计划是否是邮箱 Browser Bridge 采集。
     */
    protected boolean isMailBrowserBridge(EcosystemConnectorVo connector, String collectMode) {
        return "mail".equalsIgnoreCase(connector.getConnectorCode()) && requiresUserBrowserBridge(collectMode);
    }

    /**
     * 判断来源是否是 IMAP 协议地址，避免网页邮箱 Bridge 误把 imaps:// 当作浏览器入口。
     */
    protected boolean isMailProtocolSource(String sourceUrl) {
        String value = defaultText(sourceUrl, "").toLowerCase(Locale.ROOT);
        return value.startsWith("imap://") || value.startsWith("imaps://");
    }

    /**
     * 从 imap/imaps 地址里提取邮箱文件夹作为采集范围。
     */
    protected String mailProtocolScope(String sourceUrl) {
        if (isBlank(sourceUrl)) {
            return "";
        }
        int marker = sourceUrl.indexOf("://");
        String remainder = marker >= 0 ? sourceUrl.substring(marker + 3) : sourceUrl;
        int slash = remainder.indexOf('/');
        if (slash < 0 || slash + 1 >= remainder.length()) {
            return "";
        }
        return remainder.substring(slash + 1);
    }

    /**
     * 判断该连接器是否必须提供来源 URL。
     */
    protected boolean requiresSourceUrl(String connectorCode) {
        return "web".equalsIgnoreCase(connectorCode);
    }

    /**
     * 判断该认证方式是否必须先保存连接配置。
     */
    protected boolean requiresSavedConnection(String authType) {
        return "TOKEN".equalsIgnoreCase(authType) || "OAUTH".equalsIgnoreCase(authType)
            || "IMAP".equalsIgnoreCase(authType);
    }

    /**
     * 待调度任务引用。
     */
    protected record ScheduledTaskRef(Long taskId, Long createdBy, String scheduleType) {
    }

    /**
     * 知识库目标引用。
     */
    protected record KnowledgeTarget(Long resourceId, String resourceName, Long catalogId) {
    }

    /**
     * Browser Bridge 资产临时输出。
     */
}
