package com.iwhalecloud.byai.manager.domain.usermcp;

import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorInfoService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtMcpService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtMcp;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.UserMcpToolSnapshot;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorAuthMapper;
import com.iwhalecloud.byai.manager.mapper.resource.UserMcpToolSnapshotMapper;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class UserMcpReadToolGatewayTest {

    private SsResourceService resourceService;
    private SsResExtMcpService extService;
    private UserMcpToolSnapshotMapper snapshotMapper;
    private UserMcpRemoteClient remoteClient;
    private UserMcpReadToolGateway gateway;

    @BeforeEach
    void setUp() {
        resourceService = mock(SsResourceService.class);
        extService = mock(SsResExtMcpService.class);
        snapshotMapper = mock(UserMcpToolSnapshotMapper.class);
        remoteClient = mock(UserMcpRemoteClient.class);
        gateway = new UserMcpReadToolGateway(
            resourceService, extService, mock(ConnectorInfoService.class), mock(ConnectorAuthMapper.class),
            snapshotMapper, mock(UserMcpConfigParser.class), mock(McpCredentialEnvelopeService.class),
            new UserMcpCredentialHeaders(), remoteClient);
    }

    @Test
    void blocksUnknownToolBeforeCredentialOrNetworkAccess() {
        ownedResourceAndRevision();
        UserMcpToolSnapshot tool = tool("UNKNOWN", 3L);
        when(snapshotMapper.selectActiveTool(9L, 11L, "doThing")).thenReturn(tool);

        assertThatThrownBy(() -> gateway.call(9L, 11L, "doThing", Map.of(), 7L))
            .isInstanceOf(SecurityException.class).hasMessage("MCP_TOOL_CONFIRM_REQUIRED");
        verifyNoInteractions(remoteClient);
    }

    @Test
    void blocksSnapshotFromPreviousDefinition() {
        ownedResourceAndRevision();
        when(snapshotMapper.selectActiveTool(9L, 11L, "listItems")).thenReturn(tool("READ", 2L));

        assertThatThrownBy(() -> gateway.call(9L, 11L, "listItems", Map.of(), 7L))
            .isInstanceOf(IllegalStateException.class).hasMessage("MCP_DEFINITION_CHANGED");
        verifyNoInteractions(remoteClient);
    }

    private void ownedResourceAndRevision() {
        SsResource resource = new SsResource();
        resource.setResourceBizType("MCP");
        resource.setOwnerType("personal");
        resource.setCreateBy(7L);
        resource.setResourceStatus(1);
        when(resourceService.findById(9L)).thenReturn(resource);
        SsResExtMcp ext = new SsResExtMcp();
        ext.setDefinitionRevision(3L);
        ext.setEndpointFingerprint("fp");
        when(extService.findById(9L)).thenReturn(ext);
    }

    private UserMcpToolSnapshot tool(String risk, Long revision) {
        UserMcpToolSnapshot tool = new UserMcpToolSnapshot();
        tool.setRiskLevel(risk);
        tool.setDefinitionRevision(revision);
        tool.setInputSchema("{\"type\":\"object\"}");
        return tool;
    }
}
