package com.iwhalecloud.byai.manager.domain.usermcp;

import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.Objects;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.alibaba.fastjson.parser.Feature;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceStatus;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtMcpService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.connector.McpCredentialInput;
import com.iwhalecloud.byai.manager.dto.usermcp.UserMcpServiceDto;
import com.iwhalecloud.byai.manager.dto.usermcp.UserMcpServiceRequest;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtMcp;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorAuthMapper;

@Service
public class UserMcpServiceFacade {

    private final SsResourceService resourceService;
    private final SsResExtMcpService extMcpService;
    private final UserMcpConfigParser configParser;
    private final UserMcpToolDiscoveryService discoveryService;
    private final ConnectorAuthMapper connectorAuthMapper;

    public UserMcpServiceFacade(
            SsResourceService resourceService,
            SsResExtMcpService extMcpService,
            UserMcpConfigParser configParser,
            UserMcpToolDiscoveryService discoveryService,
            ConnectorAuthMapper connectorAuthMapper) {
        this.resourceService = resourceService;
        this.extMcpService = extMcpService;
        this.configParser = configParser;
        this.discoveryService = discoveryService;
        this.connectorAuthMapper = connectorAuthMapper;
    }

    public UserMcpServiceDto validate(UserMcpServiceRequest request) {
        validateRequest(request);
        UserMcpPublicConfig config = configParser.parse(request.sourceContent());
        List<UserMcpRemoteClient.RemoteTool> tools = discoveryService.preview(config, credentialHeaders(config, request.credentialInput()));
        return new UserMcpServiceDto(
            null, request.resourceCode(), request.resourceName(), request.resourceDesc(), configParser.toJson(config),
            null, config.endpointFingerprint(), null, toViews(tools));
    }

    @Transactional(rollbackFor = Exception.class)
    public UserMcpServiceDto create(UserMcpServiceRequest request, Long userId) {
        validateUser(userId);
        validateRequest(request);
        if (resourceService.findPersonalMcpByCreatorAndCode(userId, request.resourceCode()) != null) {
            throw new IllegalArgumentException("MCP resource code already exists for current user");
        }
        UserMcpPublicConfig config = configParser.parse(request.sourceContent());
        List<UserMcpRemoteClient.RemoteTool> tools = discoveryService.preview(config, credentialHeaders(config, request.credentialInput()));
        String canonical = configParser.toJson(config);
        SsResource resource = resourceService.createResource(newResource(request, userId));
        SsResExtMcp ext = new SsResExtMcp();
        ext.setResourceId(resource.getResourceId());
        ext.setSourceContent(canonical);
        ext.setTargetContent(withResourceId(canonical, resource.getResourceId()));
        ext.setDefinitionRevision(1L);
        ext.setEndpointFingerprint(config.endpointFingerprint());
        extMcpService.save(ext);
        UserMcpToolDiscoveryService.DiscoveryResult discovery =
            discoveryService.snapshot(resource.getResourceId(), 1L, config.endpointFingerprint(), tools);
        return toDto(resource, ext, discovery.snapshotVersion(), discovery.tools());
    }

    public List<UserMcpServiceDto> list(Long userId) {
        validateUser(userId);
        List<SsResource> resources = resourceService.findPersonalMcpsByCreator(userId);
        if (resources.isEmpty()) {
            return List.of();
        }
        List<Long> resourceIds = resources.stream().map(SsResource::getResourceId).toList();
        Map<Long, SsResExtMcp> extensions = extMcpService.findByIds(resourceIds).stream()
            .collect(Collectors.toMap(SsResExtMcp::getResourceId, Function.identity()));
        Map<Long, ConnectorAuth> authorizations = connectorAuthMapper
            .selectActiveByResourceIds(String.valueOf(userId), resourceIds).stream()
            .collect(Collectors.toMap(ConnectorAuth::getResourceId, Function.identity()));
        return resources.stream().map(resource -> {
            SsResExtMcp ext = extensions.get(resource.getResourceId());
            if (ext == null || ext.getDefinitionRevision() == null || !StringUtils.hasText(ext.getEndpointFingerprint())) {
                throw new IllegalStateException("MCP public definition is incomplete");
            }
            return toDto(resource, ext, null, List.of(), authorizations.get(resource.getResourceId()));
        }).toList();
    }

    public UserMcpServiceDto get(Long resourceId, Long userId) {
        SsResource resource = requireOwned(resourceId, userId);
        return toDto(resource, requireExtension(resourceId), null, List.of());
    }

    @Transactional(rollbackFor = Exception.class)
    public UserMcpServiceDto refreshTools(Long resourceId, McpCredentialInput credential, Long userId) {
        SsResource resource = requireOwned(resourceId, userId);
        SsResExtMcp ext = requireExtension(resourceId);
        UserMcpPublicConfig config = configParser.parse(ext.getSourceContent());
        List<UserMcpRemoteClient.RemoteTool> tools = discoveryService.preview(config, credentialHeaders(config, credential));
        SsResExtMcp lockedExt = extMcpService.findByIdForUpdate(resourceId);
        if (lockedExt == null
                || !Objects.equals(lockedExt.getDefinitionRevision(), ext.getDefinitionRevision())
                || !Objects.equals(lockedExt.getEndpointFingerprint(), ext.getEndpointFingerprint())) {
            throw new IllegalStateException("MCP_DEFINITION_CHANGED");
        }
        UserMcpToolDiscoveryService.DiscoveryResult discovery =
            discoveryService.snapshot(resourceId, lockedExt.getDefinitionRevision(), config.endpointFingerprint(), tools);
        return toDto(resource, lockedExt, discovery.snapshotVersion(), discovery.tools());
    }

    @Transactional(rollbackFor = Exception.class)
    public UserMcpServiceDto update(Long resourceId, UserMcpServiceRequest request, Long userId) {
        validateRequest(request);
        SsResource resource = requireOwned(resourceId, userId);
        if (!Objects.equals(resource.getResourceCode(), request.resourceCode())) {
            throw new IllegalArgumentException("MCP resource code cannot be changed");
        }
        SsResExtMcp ext = requireExtension(resourceId);
        UserMcpPublicConfig config = configParser.parse(request.sourceContent());
        long expectedRevision = ext.getDefinitionRevision();
        String canonical = configParser.toJson(config);
        boolean endpointChanged = !Objects.equals(ext.getEndpointFingerprint(), config.endpointFingerprint());
        resource.setResourceCode(request.resourceCode());
        resource.setResourceName(request.resourceName());
        resource.setResourceDesc(request.resourceDesc());
        resource.setUpdateBy(userId);
        resource.setUpdateTime(new Date());
        resourceService.updateResourceEntity(resource);
        ext.setSourceContent(canonical);
        ext.setTargetContent(withResourceId(canonical, resourceId));
        if (!endpointChanged) {
            extMcpService.updateDefinitionIfRevision(ext, expectedRevision);
            return toDto(resource, ext, null, List.of());
        }
        List<UserMcpRemoteClient.RemoteTool> tools =
            discoveryService.preview(config, credentialHeaders(config, request.credentialInput()));
        long newRevision = expectedRevision + 1L;
        ext.setDefinitionRevision(newRevision);
        ext.setEndpointFingerprint(config.endpointFingerprint());
        extMcpService.updateDefinitionIfRevision(ext, expectedRevision);
        UserMcpToolDiscoveryService.DiscoveryResult discovery =
            discoveryService.snapshot(resourceId, newRevision, config.endpointFingerprint(), tools);
        connectorAuthMapper.markReauthRequiredForResource(resourceId);
        return toDto(resource, ext, discovery.snapshotVersion(), discovery.tools());
    }

    @Transactional(rollbackFor = Exception.class)
    public void delete(Long resourceId, Long userId) {
        SsResource resource = requireOwned(resourceId, userId);
        resource.setResourceStatus(ResourceStatus.REMOVED.getNum());
        resource.setUpdateBy(userId);
        resource.setUpdateTime(new Date());
        resourceService.updateResourceEntity(resource);
        connectorAuthMapper.disableForResource(resourceId);
    }

    @Transactional(rollbackFor = Exception.class)
    public void setEnabled(Long resourceId, boolean enabled, Long userId) {
        requireOwned(resourceId, userId);
        SsResExtMcp ext = requireExtension(resourceId);
        int updated = connectorAuthMapper.updateInstanceEnable(
            String.valueOf(userId), resourceId, UserMcpInstanceAuthorizationService.instanceKey(resourceId),
            enabled ? "Y" : "N", ext.getDefinitionRevision(), ext.getEndpointFingerprint());
        if (updated != 1) {
            throw new IllegalStateException("MCP instance must be connected before it can be enabled");
        }
    }

    private SsResource newResource(UserMcpServiceRequest request, Long userId) {
        SsResource resource = new SsResource();
        resource.setSystemCode("BYAI");
        resource.setResourceBizType("MCP");
        resource.setResourceType("ATOM");
        resource.setResourceCode(request.resourceCode());
        resource.setResourceName(request.resourceName());
        resource.setResourceDesc(request.resourceDesc());
        resource.setResourceStatus(ResourceStatus.LIST.getNum());
        resource.setOwnerType("personal");
        resource.setHostType("hosted");
        resource.setImplType("API");
        resource.setWorkerAgentType("NONE");
        resource.setCreateBy(userId);
        resource.setUpdateBy(userId);
        return resource;
    }

    private SsResource requireOwned(Long resourceId, Long userId) {
        validateUser(userId);
        SsResource resource = resourceService.findById(resourceId);
        if (resource == null || !"MCP".equals(resource.getResourceBizType())
                || !"personal".equals(resource.getOwnerType()) || !Objects.equals(resource.getCreateBy(), userId)
                || Objects.equals(resource.getResourceStatus(), ResourceStatus.REMOVED.getNum())) {
            throw new SecurityException("MCP resource is not owned by current user");
        }
        return resource;
    }

    private SsResExtMcp requireExtension(Long resourceId) {
        SsResExtMcp ext = extMcpService.findById(resourceId);
        if (ext == null || ext.getDefinitionRevision() == null || !StringUtils.hasText(ext.getEndpointFingerprint())) {
            throw new IllegalStateException("MCP public definition is incomplete");
        }
        return ext;
    }

    private Map<String, String> credentialHeaders(UserMcpPublicConfig config, McpCredentialInput credential) {
        if (config.authProfile().mode() == UserMcpAuthMode.NONE) {
            return null;
        }
        if (credential == null || !StringUtils.hasText(credential.value())
                || !Objects.equals(config.authProfile().credentialType(), credential.type())) {
            throw new IllegalArgumentException("Matching MCP credential is required for discovery");
        }
        return switch (credential.type()) {
            case "BEARER_TOKEN" -> Map.of("Authorization", "Bearer " + credential.value());
            case "API_KEY" -> Map.of("X-API-Key", credential.value());
            case "COOKIE" -> Map.of("Cookie", credential.value());
            default -> throw new IllegalArgumentException("Unsupported MCP credential type");
        };
    }

    private String withResourceId(String canonical, Long resourceId) {
        JSONObject parsed = JSON.parseObject(canonical, Feature.OrderedField);
        JSONObject target = new JSONObject(true);
        target.put("resourceId", String.valueOf(resourceId));
        target.putAll(parsed);
        return JSON.toJSONString(target);
    }

    private List<UserMcpToolDiscoveryService.ToolView> toViews(List<UserMcpRemoteClient.RemoteTool> tools) {
        return tools.stream()
            .map(tool -> new UserMcpToolDiscoveryService.ToolView(
                tool.name(), tool.description(), tool.inputSchema(), "UNKNOWN"))
            .toList();
    }

    private UserMcpServiceDto toDto(
            SsResource resource,
            SsResExtMcp ext,
            Long snapshotVersion,
            List<UserMcpToolDiscoveryService.ToolView> tools) {
        return toDto(resource, ext, snapshotVersion, tools, null);
    }

    private UserMcpServiceDto toDto(
            SsResource resource,
            SsResExtMcp ext,
            Long snapshotVersion,
            List<UserMcpToolDiscoveryService.ToolView> tools,
            ConnectorAuth auth) {
        boolean bindingMatches = auth != null
            && Objects.equals(auth.getDefinitionRevision(), ext.getDefinitionRevision())
            && Objects.equals(auth.getEndpointFingerprint(), ext.getEndpointFingerprint());
        boolean connected = bindingMatches && "READY".equals(auth.getCredentialState())
            && "Y".equals(auth.getEnableFlag());
        return new UserMcpServiceDto(
            resource.getResourceId(), resource.getResourceCode(), resource.getResourceName(), resource.getResourceDesc(),
            ext.getSourceContent(), ext.getDefinitionRevision(), ext.getEndpointFingerprint(), snapshotVersion, tools,
            connected ? auth.getEnableFlag() : auth == null ? null : "N",
            bindingMatches ? auth.getCredentialState() : auth == null ? null : "REAUTH_REQUIRED",
            connected,
            auth == null ? null : auth.getLastVerifiedAt());
    }

    private void validateRequest(UserMcpServiceRequest request) {
        if (request == null || !StringUtils.hasText(request.resourceCode())
                || !StringUtils.hasText(request.resourceName()) || !StringUtils.hasText(request.sourceContent())) {
            throw new IllegalArgumentException("resourceCode, resourceName and sourceContent are required");
        }
        if (request.resourceCode().length() > 255 || request.resourceName().length() > 300
                || (request.resourceDesc() != null && request.resourceDesc().length() > 4_000)) {
            throw new IllegalArgumentException("MCP resource metadata is too large");
        }
    }

    private void validateUser(Long userId) {
        if (userId == null) {
            throw new SecurityException("Current user is required");
        }
    }
}
