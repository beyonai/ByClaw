package com.iwhalecloud.byai.manager.domain.usermcp;

import java.net.URI;
import java.util.Base64;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtMcpService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.connector.McpCredentialInput;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtMcp;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorAuthMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class UserMcpInstanceAuthorizationServiceTest {

    @Test
    void verifiesAndStoresInstanceBoundEncryptedCredential() {
        SsResourceService resourceService = mock(SsResourceService.class);
        SsResExtMcpService extService = mock(SsResExtMcpService.class);
        UserMcpConfigParser parser = mock(UserMcpConfigParser.class);
        UserMcpToolDiscoveryService discovery = mock(UserMcpToolDiscoveryService.class);
        ConnectorAuthMapper mapper = mock(ConnectorAuthMapper.class);
        SequenceService sequence = mock(SequenceService.class);
        UserMcpPublicConfig config = new UserMcpPublicConfig(
            "https://mcp.example.com", UserMcpPublicConfig.Transport.STREAMABLE_HTTP, "/mcp",
            URI.create("https://mcp.example.com/mcp"),
            new UserMcpPublicConfig.AuthProfile(UserMcpAuthMode.STATIC_HEADER, "BEARER_TOKEN"), 20, "fp-1");
        SsResource resource = new SsResource();
        resource.setResourceId(9L);
        resource.setResourceBizType("MCP");
        resource.setOwnerType("personal");
        resource.setCreateBy(7L);
        resource.setResourceStatus(1);
        SsResExtMcp ext = new SsResExtMcp();
        ext.setResourceId(9L);
        ext.setSourceContent("{}");
        ext.setDefinitionRevision(3L);
        ext.setEndpointFingerprint("fp-1");
        when(resourceService.findById(9L)).thenReturn(resource);
        when(extService.findByIdForUpdate(9L)).thenReturn(ext);
        when(parser.parse("{}")).thenReturn(config);
        when(discovery.preview(any(), any())).thenReturn(List.of());
        when(sequence.nextVal()).thenReturn(99L);
        when(mapper.insertActiveIgnoreConflict(any())).thenReturn(1);

        UserMcpInstanceAuthorizationService service = new UserMcpInstanceAuthorizationService(
            resourceService, extService, parser, discovery, new UserMcpCredentialHeaders(),
            new McpCredentialEnvelopeService(Base64.getEncoder().encodeToString(new byte[32])), mapper, sequence);
        ConnectorInfo connector = new ConnectorInfo();
        connector.setConnectorId(5L);
        service.authorize(9L, "7", connector, new McpCredentialInput("BEARER_TOKEN", "secret-canary"));

        ArgumentCaptor<ConnectorAuth> captor = ArgumentCaptor.forClass(ConnectorAuth.class);
        verify(mapper).insertActiveIgnoreConflict(captor.capture());
        ConnectorAuth saved = captor.getValue();
        assertThat(saved.getInstanceKey()).isEqualTo("resource:9");
        assertThat(saved.getDefinitionRevision()).isEqualTo(3L);
        assertThat(saved.getEndpointFingerprint()).isEqualTo("fp-1");
        assertThat(saved.getAuthCredential()).doesNotContain("secret-canary");
        assertThat(saved.getCredentialState()).isEqualTo("READY");
    }
}
