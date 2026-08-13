package com.iwhalecloud.byai.manager.domain.usermcp;

import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceStatus;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtMcpService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.connector.McpCredentialInput;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtMcp;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorAuthMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

/** Synchronous phase-one authorization for a concrete user-managed MCP resource. */
@Service
public class UserMcpInstanceAuthorizationService {

    private final SsResourceService resourceService;
    private final SsResExtMcpService extMcpService;
    private final UserMcpConfigParser configParser;
    private final UserMcpToolDiscoveryService discoveryService;
    private final UserMcpCredentialHeaders credentialHeaders;
    private final McpCredentialEnvelopeService envelopeService;
    private final ConnectorAuthMapper connectorAuthMapper;
    private final SequenceService sequenceService;

    public UserMcpInstanceAuthorizationService(
            SsResourceService resourceService,
            SsResExtMcpService extMcpService,
            UserMcpConfigParser configParser,
            UserMcpToolDiscoveryService discoveryService,
            UserMcpCredentialHeaders credentialHeaders,
            McpCredentialEnvelopeService envelopeService,
            ConnectorAuthMapper connectorAuthMapper,
            SequenceService sequenceService) {
        this.resourceService = resourceService;
        this.extMcpService = extMcpService;
        this.configParser = configParser;
        this.discoveryService = discoveryService;
        this.credentialHeaders = credentialHeaders;
        this.envelopeService = envelopeService;
        this.connectorAuthMapper = connectorAuthMapper;
        this.sequenceService = sequenceService;
    }

    @Transactional(rollbackFor = Exception.class)
    public void authorize(Long resourceId, String userId, ConnectorInfo connector, McpCredentialInput credential) {
        long numericUserId = parseUserId(userId);
        SsResource resource = resourceService.findById(resourceId);
        if (!isOwned(resource, numericUserId)) {
            throw new SecurityException("MCP resource is not owned by current user");
        }
        SsResExtMcp ext = extMcpService.findByIdForUpdate(resourceId);
        if (ext == null || ext.getDefinitionRevision() == null || ext.getEndpointFingerprint() == null) {
            throw new IllegalStateException("MCP public definition is incomplete");
        }
        UserMcpPublicConfig config = configParser.parse(ext.getSourceContent());
        Map<String, String> headers = credentialHeaders.from(config, credential);
        List<UserMcpRemoteClient.RemoteTool> tools = discoveryService.preview(config, headers);
        discoveryService.snapshot(resourceId, ext.getDefinitionRevision(), config.endpointFingerprint(), tools);

        String instanceKey = instanceKey(resourceId);
        ConnectorAuth auth = connectorAuthMapper.selectActiveByInstance(userId, connector.getConnectorId(), instanceKey);
        Date now = new Date();
        if (auth == null) {
            auth = new ConnectorAuth();
            auth.setAuthId(sequenceService.nextVal());
            auth.setUserId(userId);
            auth.setConnectorId(connector.getConnectorId());
            auth.setInstanceKey(instanceKey);
            auth.setCreateBy(userId);
            auth.setCreateTime(now);
            auth.setStatusCd("00A");
        }
        auth.setResourceId(resourceId);
        auth.setDefinitionRevision(ext.getDefinitionRevision());
        auth.setEndpointFingerprint(ext.getEndpointFingerprint());
        auth.setAuthMode(config.authProfile().mode().name());
        auth.setAuthCredential(sealCredential(config, credential, userId, resourceId, ext));
        auth.setCredentialState("READY");
        auth.setRenewalMode(config.authProfile().mode() == UserMcpAuthMode.NONE ? "NONE" : "CREDENTIAL_REISSUE");
        auth.setLastVerifiedAt(now);
        auth.setLastSyncTime(now);
        auth.setEnableFlag("Y");
        auth.setUpdateTime(now);
        if (connectorAuthMapper.selectById(auth.getAuthId()) == null) {
            if (connectorAuthMapper.insertActiveIgnoreConflict(auth) == 0) {
                ConnectorAuth concurrent = connectorAuthMapper.selectActiveByInstance(
                    userId, connector.getConnectorId(), instanceKey);
                if (concurrent == null) {
                    throw new IllegalStateException("MCP authorization binding could not be persisted");
                }
                auth.setAuthId(concurrent.getAuthId());
                connectorAuthMapper.updateById(auth);
            }
        } else {
            connectorAuthMapper.updateById(auth);
        }
    }

    public static String instanceKey(Long resourceId) {
        if (resourceId == null) {
            throw new IllegalArgumentException("resourceId is required for user MCP authorization");
        }
        return "resource:" + resourceId;
    }

    public static String credentialContext(
            String userId, Long resourceId, Long revision, String endpointFingerprint) {
        return userId + ":" + resourceId + ":" + revision + ":" + endpointFingerprint;
    }

    private String sealCredential(
            UserMcpPublicConfig config,
            McpCredentialInput input,
            String userId,
            Long resourceId,
            SsResExtMcp ext) {
        if (config.authProfile().mode() == UserMcpAuthMode.NONE) {
            return null;
        }
        JSONObject payload = new JSONObject(true);
        payload.put("type", input.type());
        payload.put("value", input.value());
        return envelopeService.seal(
            JSON.toJSONString(payload),
            credentialContext(userId, resourceId, ext.getDefinitionRevision(), ext.getEndpointFingerprint()));
    }

    private long parseUserId(String userId) {
        try {
            return Long.parseLong(userId);
        } catch (RuntimeException e) {
            throw new SecurityException("Current user is invalid", e);
        }
    }

    private boolean isOwned(SsResource resource, long userId) {
        return resource != null && "MCP".equals(resource.getResourceBizType())
            && "personal".equals(resource.getOwnerType()) && Objects.equals(resource.getCreateBy(), userId)
            && !Objects.equals(resource.getResourceStatus(), ResourceStatus.REMOVED.getNum());
    }
}
