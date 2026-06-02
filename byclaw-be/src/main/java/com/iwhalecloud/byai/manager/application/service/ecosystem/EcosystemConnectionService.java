package com.iwhalecloud.byai.manager.application.service.ecosystem;

import java.util.Collections;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.iwhalecloud.byai.manager.dto.ecosystem.EcosystemAgentHeartbeatRequest;
import com.iwhalecloud.byai.manager.vo.ecosystem.EcosystemAgentStatusVo;
import com.iwhalecloud.byai.manager.vo.ecosystem.EcosystemConnectorVo;
import com.iwhalecloud.byai.manager.vo.ecosystem.EcosystemTaskVo;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 生态采集连接、登录态和连接器能力服务。
 *
 * @author qin.guoquan
 * @date 2026-05-29 21:12:18
 */
@Service
public class EcosystemConnectionService extends EcosystemCollectionSupport {

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private OpenCliCapabilityService openCliCapabilityService;

    /**
     * 查询启用的生态连接器能力清单。
     *
     * @return 连接器视图列表
     */
    public List<EcosystemConnectorVo> listConnectors() {
        return openCliCapabilityService.listVirtualConnectors();
    }

    /**
     * 获取当前用户最近一次 Browser Bridge 状态；没有心跳时返回离线默认状态。
     *
     * @return Browser Bridge 状态
     */
    public EcosystemAgentStatusVo getLocalAgentStatus() {
        List<EcosystemAgentStatusVo> statuses = jdbcTemplate.query("""
            SELECT agent_name, runtime_name, runtime_version, browser_bridge_status, chrome_profile, status,
                   last_heartbeat_time, CAST(site_sessions AS TEXT) AS site_sessions
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
                       CAST(credential_config AS TEXT) AS credential_config,
                       CAST(runtime_config AS TEXT) AS runtime_config,
                       CAST(site_sessions AS TEXT) AS site_sessions, status, last_check_time, create_time
                  FROM byai.bykc_ec_connection
                 WHERE created_by = ?
                 ORDER BY update_time DESC, connection_id DESC
                """, connectionRowMapper(), currentUserId());
        }
        return jdbcTemplate.query("""
            SELECT connection_id, connector_code, owner_type, auth_type, connection_name, run_location,
                   CAST(credential_config AS TEXT) AS credential_config,
                   CAST(runtime_config AS TEXT) AS runtime_config,
                   CAST(site_sessions AS TEXT) AS site_sessions, status, last_check_time, create_time
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

        String collectMode = normalizeCollectMode(stringValue(request.get("collectMode")), connector);
        String authType = defaultText(stringValue(request.get("authType")), defaultAuthType(connector, collectMode));
        String runLocation = defaultText(stringValue(request.get("runLocation")), defaultRunLocation(collectMode));
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
     * 接收浏览器登录态能力心跳并刷新状态。
     *
     * @param request 心跳请求
     * @return 最新采集端状态
     */
    public EcosystemAgentStatusVo heartbeat(EcosystemAgentHeartbeatRequest request) {
        EcosystemAgentHeartbeatRequest heartbeatRequest = request == null
            ? new EcosystemAgentHeartbeatRequest()
            : request;
        if (isBlank(heartbeatRequest.getRuntimeName())) {
            heartbeatRequest.setRuntimeName("ByClaw Browser Bridge");
        }
        if (isBlank(heartbeatRequest.getStatus())) {
            heartbeatRequest.setStatus("ONLINE");
        }
        upsertAgentHeartbeat(heartbeatRequest);
        return getLocalAgentStatus();
    }

    /**
     * 运行前临时注入连接凭据给采集执行器。凭据不写回任务 options，避免在任务表中复制敏感信息。
     */
    public void attachConnectionCredentialConfig(EcosystemTaskVo task) {
        if (task == null || task.getConnectionId() == null) {
            return;
        }
        Map<String, Object> credentialConfig = findCredentialConfig(task.getConnectionId());
        if (credentialConfig.isEmpty()) {
            return;
        }
        Map<String, Object> options = new LinkedHashMap<>(defaultMap(task.getOptions()));
        options.put("credentialConfig", credentialConfig);
        task.setOptions(options);
    }


    /**
     * 查找当前用户某连接器最适合复用的连接配置，优先 READY。
     */
    public Map<String, Object> findPreferredConnection(String connectorCode) {
        List<Map<String, Object>> connections = jdbcTemplate.query("""
            SELECT connection_id, connector_code, owner_type, auth_type, connection_name, run_location,
                   CAST(credential_config AS TEXT) AS credential_config,
                   CAST(runtime_config AS TEXT) AS runtime_config,
                   CAST(site_sessions AS TEXT) AS site_sessions, status, last_check_time, create_time
              FROM byai.bykc_ec_connection
             WHERE created_by = ? AND LOWER(connector_code) = LOWER(?)
             ORDER BY CASE WHEN status = 'READY' THEN 0 ELSE 1 END, update_time DESC, connection_id DESC
             LIMIT 1
            """, connectionRowMapper(), currentUserId(), connectorCode);
        return connections.isEmpty() ? Collections.emptyMap() : connections.get(0);
    }


    /**
     * 查询运行时连接器能力。
     */
    public EcosystemConnectorVo findConnector(String connectorCode) {
        return openCliCapabilityService.findVirtualConnector(connectorCode)
            .orElseThrow(() -> new IllegalArgumentException(
                i18n("ecosystem.error.connector.unsupported", connectorCode)));
    }

    /**
     * 校验连接配置归属当前用户且属于指定连接器。
     */
    public void ensureConnectionOwned(Long connectionId, String connectorCode) {
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
    public Map<String, Object> findConnectionView(Long connectionId) {
        List<Map<String, Object>> connections = jdbcTemplate.query("""
            SELECT connection_id, connector_code, owner_type, auth_type, connection_name, run_location,
                   CAST(credential_config AS TEXT) AS credential_config,
                   CAST(runtime_config AS TEXT) AS runtime_config,
                   CAST(site_sessions AS TEXT) AS site_sessions, status, last_check_time, create_time
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
    public Map<String, Object> findCredentialConfig(Long connectionId) {
        if (connectionId == null) {
            return Collections.emptyMap();
        }
        List<String> configs = jdbcTemplate.query("""
            SELECT CAST(credential_config AS TEXT)
              FROM byai.bykc_ec_connection
             WHERE connection_id = ? AND created_by = ?
            """, (rs, rowNum) -> rs.getString(1), connectionId, currentUserId());
        if (configs.isEmpty()) {
            return Collections.emptyMap();
        }
        return fromJson(configs.get(0), MAP_TYPE, Collections.emptyMap());
    }

    /**
     * 查询连接运行时配置，内部用于把服务端托管浏览器 Profile 固化进任务 options。
     */
    public Map<String, Object> findRuntimeConfig(Long connectionId) {
        if (connectionId == null) {
            return Collections.emptyMap();
        }
        List<String> configs = jdbcTemplate.query("""
            SELECT CAST(runtime_config AS TEXT)
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
        putIfPresent(config, "imapPort", request.get("imapPort"));
        putIfPresent(config, "imapSsl", request.get("imapSsl"));
        putIfPresent(config, "imapFolder", stringValue(request.get("imapFolder")));
        putIfPresent(config, "oauthProvider", stringValue(request.get("oauthProvider")));
        return config;
    }

    /**
     * 构造运行时配置，例如 Chrome Profile、OpenCLI Profile 和服务端地址。
     */
    private Map<String, Object> buildRuntimeConfig(Map<String, Object> request) {
        Map<String, Object> config = new LinkedHashMap<>();
        putIfPresent(config, "collectMode", stringValue(request.get("collectMode")));
        putIfPresent(config, "chromeProfile", stringValue(request.get("chromeProfile")));
        putIfPresent(config, "openCliProfile", stringValue(request.get("openCliProfile")));
        putIfPresent(config, "serverEndpoint", stringValue(request.get("serverEndpoint")));
        return config;
    }

    /**
     * 根据认证方式和凭据完整度计算连接状态。
     */
    private String resolveConnectionStatus(String authType, Map<String, Object> credentialConfig) {
        if ("IMAP".equalsIgnoreCase(authType)) {
            return credentialConfig.containsKey("token")
                && !isBlank(stringValue(credentialConfig.get("account")))
                && !isBlank(stringValue(credentialConfig.get("imapHost"))) ? STATUS_READY : STATUS_NEED_AUTH;
        }
        if ("TOKEN".equalsIgnoreCase(authType) || "OAUTH".equalsIgnoreCase(authType)
            || "IMAP".equalsIgnoreCase(authType)) {
            return credentialConfig.containsKey("token") || Boolean.TRUE.equals(credentialConfig.get("tokenConfigured"))
                ? "READY" : "NEED_AUTH";
        }
        if ("BROWSER".equalsIgnoreCase(authType)) {
            return STATUS_NEED_AUTH;
        }
        return STATUS_READY;
    }

    /**
     * 新增或更新当前用户 Browser Bridge 心跳。
     */
    private void upsertAgentHeartbeat(EcosystemAgentHeartbeatRequest request) {
        String agentName = defaultText(request.getAgentName(), i18n("ecosystem.browser.bridge.name", defaultUserName()));
        String runtimeName = defaultText(request.getRuntimeName(), "ByClaw Browser Bridge");
        String chromeProfile = defaultText(request.getChromeProfile(), "bykc-local");
        List<Long> agentIds = jdbcTemplate.query("""
            SELECT agent_id
              FROM byai.bykc_ec_collector_agent
             WHERE user_id = ? AND agent_name = ? AND runtime_name = ? AND chrome_profile = ?
             ORDER BY update_time DESC, agent_id DESC
             LIMIT 1
            """, (rs, rowNum) -> rs.getLong("agent_id"), currentUserId(), agentName, runtimeName, chromeProfile);
        Date now = new Date();
        String siteSessions = toJson(defaultSiteSessions(request.getSiteSessions()));
        if (agentIds.isEmpty()) {
            jdbcTemplate.update("""
                INSERT INTO byai.bykc_ec_collector_agent (
                    agent_id, user_id, agent_name, runtime_name, runtime_version,
                    browser_bridge_status, chrome_profile, site_sessions, status,
                    last_heartbeat_time, create_time, update_time
                ) VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSONB), ?, ?, ?, ?)
                """,
                sequenceService.nextVal(),
                currentUserId(),
                agentName,
                runtimeName,
                defaultText(request.getRuntimeVersion(), "-"),
                defaultText(request.getBrowserBridgeStatus(), "UNKNOWN"),
                chromeProfile,
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
            agentName,
            runtimeName,
            defaultText(request.getRuntimeVersion(), "-"),
            defaultText(request.getBrowserBridgeStatus(), "UNKNOWN"),
            chromeProfile,
            siteSessions,
            defaultText(request.getStatus(), "ONLINE"),
            now,
            now,
                agentIds.get(0));
    }

}
