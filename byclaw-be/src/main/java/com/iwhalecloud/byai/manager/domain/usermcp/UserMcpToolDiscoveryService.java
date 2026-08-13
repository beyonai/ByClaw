package com.iwhalecloud.byai.manager.domain.usermcp;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Date;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.manager.entity.resource.UserMcpToolSnapshot;
import com.iwhalecloud.byai.manager.mapper.resource.UserMcpToolSnapshotMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

@Service
public class UserMcpToolDiscoveryService {

    private static final int MAX_TOOL_COUNT = 200;
    private static final int MAX_TOOL_NAME_LENGTH = 255;
    private static final int MAX_DESCRIPTION_LENGTH = 4_000;
    private static final int MAX_SCHEMA_LENGTH = 65_536;

    private final UserMcpRemoteClient remoteClient;
    private final UserMcpToolSnapshotMapper snapshotMapper;
    private final SequenceService sequenceService;

    public UserMcpToolDiscoveryService(
            UserMcpRemoteClient remoteClient,
            UserMcpToolSnapshotMapper snapshotMapper,
            SequenceService sequenceService) {
        this.remoteClient = remoteClient;
        this.snapshotMapper = snapshotMapper;
        this.sequenceService = sequenceService;
    }

    @Transactional(rollbackFor = Exception.class)
    public DiscoveryResult discoverAndSnapshot(
            Long resourceId,
            Long definitionRevision,
            UserMcpPublicConfig config,
            Map<String, String> credentialHeaders) {
        if (resourceId == null || definitionRevision == null || config == null) {
            throw new IllegalArgumentException("MCP discovery context is incomplete");
        }
        List<UserMcpRemoteClient.RemoteTool> tools = preview(config, credentialHeaders);
        return snapshot(resourceId, definitionRevision, config.endpointFingerprint(), tools);
    }

    public List<UserMcpRemoteClient.RemoteTool> preview(
            UserMcpPublicConfig config,
            Map<String, String> credentialHeaders) {
        if (config == null) {
            throw new IllegalArgumentException("MCP public config is required");
        }
        List<UserMcpRemoteClient.RemoteTool> tools = remoteClient.discover(config, credentialHeaders);
        validateCatalog(tools);
        return List.copyOf(tools);
    }

    @Transactional(rollbackFor = Exception.class)
    public DiscoveryResult snapshot(
            Long resourceId,
            Long definitionRevision,
            List<UserMcpRemoteClient.RemoteTool> tools) {
        return snapshot(resourceId, definitionRevision, null, tools);
    }

    @Transactional(rollbackFor = Exception.class)
    public DiscoveryResult snapshot(
            Long resourceId,
            Long definitionRevision,
            String endpointFingerprint,
            List<UserMcpRemoteClient.RemoteTool> tools) {
        if (resourceId == null || definitionRevision == null) {
            throw new IllegalArgumentException("MCP snapshot context is incomplete");
        }
        validateCatalog(tools);
        long snapshotVersion = sequenceService.nextVal();
        snapshotMapper.deactivateActive(resourceId);
        Date now = new Date();
        for (UserMcpRemoteClient.RemoteTool tool : tools) {
            UserMcpToolSnapshot snapshot = new UserMcpToolSnapshot();
            snapshot.setSnapshotId(sequenceService.nextVal());
            snapshot.setResourceId(resourceId);
            snapshot.setDefinitionRevision(definitionRevision);
            snapshot.setSnapshotVersion(snapshotVersion);
            snapshot.setToolName(tool.name());
            snapshot.setDescription(tool.description());
            snapshot.setInputSchema(tool.inputSchema());
            snapshot.setSchemaHash(sha256(tool.inputSchema()));
            snapshot.setRiskLevel("READ");
            snapshot.setRiskSource("SYSTEM_DEFAULT");
            snapshot.setStatusCd("00A");
            snapshot.setCreateTime(now);
            snapshotMapper.insert(snapshot);
        }
        List<ToolView> views = tools.stream()
            .map(tool -> new ToolView(
                tool.name(), tool.description(), tool.inputSchema(), "READ"))
            .toList();
        return new DiscoveryResult(snapshotVersion, views);
    }

    private void validateCatalog(List<UserMcpRemoteClient.RemoteTool> tools) {
        if (tools == null || tools.isEmpty()) {
            throw new IllegalArgumentException("MCP service did not expose any tools");
        }
        if (tools.size() > MAX_TOOL_COUNT) {
            throw new IllegalArgumentException("MCP tool catalog is too large");
        }
        Set<String> names = new HashSet<>();
        for (UserMcpRemoteClient.RemoteTool tool : tools) {
            if (tool == null || !StringUtils.hasText(tool.name()) || tool.name().length() > MAX_TOOL_NAME_LENGTH
                    || !names.add(tool.name())) {
                throw new IllegalArgumentException("MCP tool name is invalid or duplicated");
            }
            if (tool.description() != null && tool.description().length() > MAX_DESCRIPTION_LENGTH) {
                throw new IllegalArgumentException("MCP tool description is too large");
            }
            if (!StringUtils.hasText(tool.inputSchema()) || tool.inputSchema().length() > MAX_SCHEMA_LENGTH) {
                throw new IllegalArgumentException("MCP tool schema is invalid or too large");
            }
            try {
                if (JSON.parse(tool.inputSchema()) == null) {
                    throw new IllegalArgumentException("MCP tool schema is empty");
                }
            } catch (RuntimeException e) {
                throw new IllegalArgumentException("MCP tool schema is invalid JSON", e);
            }
        }
    }

    private String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
    }

    public record DiscoveryResult(long snapshotVersion, List<ToolView> tools) {
    }

    public record ToolView(String name, String description, String inputSchema, String riskLevel) {
    }
}
