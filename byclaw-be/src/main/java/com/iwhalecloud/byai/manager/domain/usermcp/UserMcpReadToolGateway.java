package com.iwhalecloud.byai.manager.domain.usermcp;

import java.util.List;
import java.util.Map;
import java.util.Objects;

import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorInfoService;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceStatus;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtMcpService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtMcp;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.UserMcpToolSnapshot;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorAuthMapper;
import com.iwhalecloud.byai.manager.mapper.resource.UserMcpToolSnapshotMapper;

/** Phase-one gateway: only a snapshotted READ tool may reach a bound MCP endpoint. */
@Service
public class UserMcpReadToolGateway {

    private static final int MAX_ARGUMENT_JSON_LENGTH = 65_536;

    private final SsResourceService resourceService;
    private final SsResExtMcpService extMcpService;
    private final ConnectorInfoService connectorInfoService;
    private final ConnectorAuthMapper connectorAuthMapper;
    private final UserMcpToolSnapshotMapper snapshotMapper;
    private final UserMcpConfigParser configParser;
    private final McpCredentialEnvelopeService envelopeService;
    private final UserMcpCredentialHeaders credentialHeaders;
    private final UserMcpRemoteClient remoteClient;

    public UserMcpReadToolGateway(
            SsResourceService resourceService,
            SsResExtMcpService extMcpService,
            ConnectorInfoService connectorInfoService,
            ConnectorAuthMapper connectorAuthMapper,
            UserMcpToolSnapshotMapper snapshotMapper,
            UserMcpConfigParser configParser,
            McpCredentialEnvelopeService envelopeService,
            UserMcpCredentialHeaders credentialHeaders,
            UserMcpRemoteClient remoteClient) {
        this.resourceService = resourceService;
        this.extMcpService = extMcpService;
        this.connectorInfoService = connectorInfoService;
        this.connectorAuthMapper = connectorAuthMapper;
        this.snapshotMapper = snapshotMapper;
        this.configParser = configParser;
        this.envelopeService = envelopeService;
        this.credentialHeaders = credentialHeaders;
        this.remoteClient = remoteClient;
    }

    public String call(
            Long resourceId,
            Long snapshotVersion,
            String toolName,
            Map<String, Object> arguments,
            Long userId) {
        SsResource resource = resourceService.findById(resourceId);
        if (!isOwned(resource, userId)) {
            throw new SecurityException("MCP resource is not owned by current user");
        }
        SsResExtMcp ext = extMcpService.findById(resourceId);
        if (ext == null) {
            throw new IllegalStateException("MCP definition is missing");
        }
        UserMcpToolSnapshot tool = snapshotMapper.selectActiveTool(resourceId, snapshotVersion, toolName);
        if (tool == null || !Objects.equals(tool.getDefinitionRevision(), ext.getDefinitionRevision())) {
            throw new IllegalStateException("MCP_DEFINITION_CHANGED");
        }
        if (!"READ".equals(tool.getRiskLevel())) {
            throw new SecurityException("MCP_TOOL_CONFIRM_REQUIRED");
        }
        validateArguments(tool.getInputSchema(), arguments);
        ConnectorInfo connector = connectorInfoService.findByCode("user-mcp");
        if (connector == null || !"00A".equals(connector.getStatusCd())) {
            throw new IllegalStateException("MCP connector is unavailable");
        }
        String stringUserId = String.valueOf(userId);
        ConnectorAuth auth = connectorAuthMapper.selectActiveByInstance(
            stringUserId, connector.getConnectorId(), UserMcpInstanceAuthorizationService.instanceKey(resourceId));
        if (!validBinding(auth, ext)) {
            throw new SecurityException("MCP_AUTH_REQUIRED");
        }
        UserMcpPublicConfig config = configParser.parse(ext.getSourceContent());
        Map<String, String> headers = credentialHeaders(config, auth, stringUserId, resourceId, ext);
        return remoteClient.call(config, headers, toolName, arguments == null ? Map.of() : arguments);
    }

    private Map<String, String> credentialHeaders(
            UserMcpPublicConfig config,
            ConnectorAuth auth,
            String userId,
            Long resourceId,
            SsResExtMcp ext) {
        if (config.authProfile().mode() == UserMcpAuthMode.NONE) {
            return Map.of();
        }
        String plaintext = envelopeService.open(
            auth.getAuthCredential(),
            UserMcpInstanceAuthorizationService.credentialContext(
                userId, resourceId, ext.getDefinitionRevision(), ext.getEndpointFingerprint()));
        JSONObject credential = JSON.parseObject(plaintext);
        return credentialHeaders.fromValue(credential.getString("type"), credential.getString("value"));
    }

    private boolean validBinding(ConnectorAuth auth, SsResExtMcp ext) {
        return auth != null && "00A".equals(auth.getStatusCd()) && "Y".equals(auth.getEnableFlag())
            && "READY".equals(auth.getCredentialState())
            && Objects.equals(auth.getDefinitionRevision(), ext.getDefinitionRevision())
            && Objects.equals(auth.getEndpointFingerprint(), ext.getEndpointFingerprint());
    }

    private void validateArguments(String schemaJson, Map<String, Object> arguments) {
        Map<String, Object> safe = arguments == null ? Map.of() : arguments;
        if (JSON.toJSONString(safe).length() > MAX_ARGUMENT_JSON_LENGTH) {
            throw new IllegalArgumentException("MCP tool arguments are too large");
        }
        JSONObject schema = JSON.parseObject(schemaJson);
        JSONArray required = schema == null ? null : schema.getJSONArray("required");
        if (required != null) {
            List<String> missing = required.toJavaList(String.class).stream().filter(key -> !safe.containsKey(key)).toList();
            if (!missing.isEmpty()) {
                throw new IllegalArgumentException("Missing required MCP tool arguments: " + String.join(",", missing));
            }
        }
        JSONObject properties = schema == null ? null : schema.getJSONObject("properties");
        if (Boolean.FALSE.equals(schema == null ? null : schema.getBoolean("additionalProperties"))
                && properties != null && safe.keySet().stream().anyMatch(key -> !properties.containsKey(key))) {
            throw new IllegalArgumentException("MCP tool arguments contain unknown fields");
        }
    }

    private boolean isOwned(SsResource resource, Long userId) {
        return resource != null && userId != null && "MCP".equals(resource.getResourceBizType())
            && "personal".equals(resource.getOwnerType()) && Objects.equals(resource.getCreateBy(), userId)
            && !Objects.equals(resource.getResourceStatus(), ResourceStatus.REMOVED.getNum());
    }
}
