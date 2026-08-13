package com.iwhalecloud.byai.manager.domain.usermcp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.net.URI;
import java.util.Date;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtMcpService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.usermcp.UserMcpPublicConfig.AuthProfile;
import com.iwhalecloud.byai.manager.domain.usermcp.UserMcpPublicConfig.Transport;
import com.iwhalecloud.byai.manager.dto.connector.McpCredentialInput;
import com.iwhalecloud.byai.manager.dto.usermcp.UserMcpServiceRequest;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtMcp;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorAuthMapper;

@ExtendWith(MockitoExtension.class)
class UserMcpServiceFacadeTest {

    @Mock
    private SsResourceService resourceService;

    @Mock
    private SsResExtMcpService extMcpService;

    @Mock
    private UserMcpConfigParser configParser;

    @Mock
    private UserMcpToolDiscoveryService discoveryService;

    @Mock
    private ConnectorAuthMapper connectorAuthMapper;

    private UserMcpServiceFacade facade;

    @BeforeEach
    void setUp() {
        facade = new UserMcpServiceFacade(
            resourceService,
            extMcpService,
            configParser,
            discoveryService,
            connectorAuthMapper
        );
    }

    @Test
    void validateDefaultsPreviewedToolsToRead() {
        UserMcpPublicConfig config = config("fingerprint-a", UserMcpAuthMode.NONE, null);
        UserMcpServiceRequest request = new UserMcpServiceRequest(
            "personal-search", "Personal Search", "description", "{\"public\":true}", null);
        when(configParser.parse(request.sourceContent())).thenReturn(config);
        when(configParser.toJson(config)).thenReturn("{\"public\":true}");
        when(discoveryService.preview(config, null)).thenReturn(List.of(
            new UserMcpRemoteClient.RemoteTool("search", "Search", "{\"type\":\"object\"}")
        ));

        var result = facade.validate(request);

        assertThat(result.tools()).extracting(UserMcpToolDiscoveryService.ToolView::riskLevel)
            .containsExactly("READ");
    }

    @Test
    void createPersistsOnlyCanonicalPublicConfigAfterSuccessfulPreview() {
        UserMcpPublicConfig config = config("fingerprint-a", UserMcpAuthMode.STATIC_HEADER, "BEARER_TOKEN");
        UserMcpServiceRequest request = new UserMcpServiceRequest(
            "personal-search",
            "Personal Search",
            "description",
            "{\"headers\":{\"Authorization\":\"canary-secret\"}}",
            new McpCredentialInput("BEARER_TOKEN", "canary-secret")
        );
        List<UserMcpRemoteClient.RemoteTool> remoteTools = List.of(
            new UserMcpRemoteClient.RemoteTool("search", "Search", "{\"type\":\"object\"}")
        );
        when(configParser.parse(request.sourceContent())).thenReturn(config);
        when(configParser.toJson(config)).thenReturn("{\"public\":true}");
        when(discoveryService.preview(eq(config), any())).thenReturn(remoteTools);
        when(resourceService.createResource(any(SsResource.class))).thenAnswer(invocation -> {
            SsResource resource = invocation.getArgument(0);
            resource.setResourceId(99L);
            return resource;
        });
        when(discoveryService.snapshot(99L, 1L, "fingerprint-a", remoteTools))
            .thenReturn(new UserMcpToolDiscoveryService.DiscoveryResult(700L, List.of(
                new UserMcpToolDiscoveryService.ToolView("search", "Search", "{\"type\":\"object\"}", "READ")
            )));

        var result = facade.create(request, 42L);

        assertThat(result.resourceId()).isEqualTo(99L);
        assertThat(result.definitionRevision()).isEqualTo(1L);
        ArgumentCaptor<SsResource> resourceCaptor = ArgumentCaptor.forClass(SsResource.class);
        verify(resourceService).createResource(resourceCaptor.capture());
        assertThat(resourceCaptor.getValue().getCreateBy()).isEqualTo(42L);
        assertThat(resourceCaptor.getValue().getOwnerType()).isEqualTo("personal");
        ArgumentCaptor<SsResExtMcp> extCaptor = ArgumentCaptor.forClass(SsResExtMcp.class);
        verify(extMcpService).save(extCaptor.capture());
        assertThat(extCaptor.getValue().getSourceContent()).isEqualTo("{\"public\":true}");
        assertThat(extCaptor.getValue().getTargetContent()).contains("\"resourceId\":\"99\"")
            .doesNotContain("canary-secret");
        verify(discoveryService).preview(config, java.util.Map.of("Authorization", "Bearer canary-secret"));
    }

    @Test
    void rejectsCrossUserAccessBeforeReadingMcpExtension() {
        SsResource resource = ownedResource(99L, 7L);
        when(resourceService.findById(99L)).thenReturn(resource);

        assertThatThrownBy(() -> facade.get(99L, 42L))
            .isInstanceOf(SecurityException.class);
        verify(extMcpService, never()).findById(any());
    }

    @Test
    void endpointChangeIncrementsRevisionAndInvalidatesExistingBinding() {
        SsResource resource = ownedResource(99L, 42L);
        SsResExtMcp existing = new SsResExtMcp();
        existing.setResourceId(99L);
        existing.setDefinitionRevision(3L);
        existing.setEndpointFingerprint("fingerprint-a");
        existing.setSourceContent("{\"old\":true}");
        UserMcpPublicConfig changed = config("fingerprint-b", UserMcpAuthMode.NONE, null);
        UserMcpServiceRequest request = new UserMcpServiceRequest(
            "personal-search", "Updated", "description", "{\"new\":true}", null);
        List<UserMcpRemoteClient.RemoteTool> tools = List.of(
            new UserMcpRemoteClient.RemoteTool("search", "Search", "{\"type\":\"object\"}")
        );
        when(resourceService.findById(99L)).thenReturn(resource);
        when(extMcpService.findById(99L)).thenReturn(existing);
        when(configParser.parse(request.sourceContent())).thenReturn(changed);
        when(configParser.toJson(changed)).thenReturn("{\"public\":true}");
        when(discoveryService.preview(changed, null)).thenReturn(tools);
        when(discoveryService.snapshot(99L, 4L, "fingerprint-b", tools))
            .thenReturn(new UserMcpToolDiscoveryService.DiscoveryResult(701L, List.of()));

        var result = facade.update(99L, request, 42L);

        assertThat(result.definitionRevision()).isEqualTo(4L);
        ArgumentCaptor<SsResExtMcp> extCaptor = ArgumentCaptor.forClass(SsResExtMcp.class);
        verify(extMcpService).updateDefinitionIfRevision(extCaptor.capture(), org.mockito.ArgumentMatchers.eq(3L));
        assertThat(extCaptor.getValue().getEndpointFingerprint()).isEqualTo("fingerprint-b");
        verify(connectorAuthMapper).markReauthRequiredForResource(99L);
    }

    @Test
    void listReturnsIndependentInstanceStatesUsingBatchQueries() {
        SsResource first = ownedResource(99L, 42L);
        SsResource second = ownedResource(100L, 42L);
        second.setResourceCode("personal-calendar");
        second.setResourceName("Personal Calendar");
        SsResExtMcp firstExt = extension(99L, 3L, "fingerprint-a");
        SsResExtMcp secondExt = extension(100L, 5L, "fingerprint-b");
        ConnectorAuth firstAuth = authorization(99L, 3L, "fingerprint-a", "Y", "READY");
        ConnectorAuth secondAuth = authorization(100L, 5L, "fingerprint-b", "N", "READY");
        when(resourceService.findPersonalMcpsByCreator(42L)).thenReturn(List.of(first, second));
        when(extMcpService.findByIds(List.of(99L, 100L))).thenReturn(List.of(firstExt, secondExt));
        when(connectorAuthMapper.selectActiveByResourceIds("42", List.of(99L, 100L)))
            .thenReturn(List.of(firstAuth, secondAuth));

        var result = facade.list(42L);

        assertThat(result).extracting(item -> item.resourceId()).containsExactly(99L, 100L);
        assertThat(result).extracting(item -> item.enableFlag()).containsExactly("Y", "N");
        assertThat(result).extracting(item -> item.connected()).containsExactly(true, false);
        verify(extMcpService, never()).findById(any());
    }

    @Test
    void metadataOnlyEditPreservesDefinitionAndActiveBinding() {
        SsResource resource = ownedResource(99L, 42L);
        SsResExtMcp existing = extension(99L, 3L, "fingerprint-a");
        UserMcpPublicConfig unchanged = config("fingerprint-a", UserMcpAuthMode.STATIC_HEADER, "BEARER_TOKEN");
        UserMcpServiceRequest request = new UserMcpServiceRequest(
            "personal-search", "Renamed", "updated description", "{\"same\":true}", null);
        when(resourceService.findById(99L)).thenReturn(resource);
        when(extMcpService.findById(99L)).thenReturn(existing);
        when(configParser.parse(request.sourceContent())).thenReturn(unchanged);
        when(configParser.toJson(unchanged)).thenReturn("{\"public\":true}");

        var result = facade.update(99L, request, 42L);

        assertThat(result.definitionRevision()).isEqualTo(3L);
        assertThat(resource.getResourceName()).isEqualTo("Renamed");
        verify(discoveryService, never()).preview(any(), any());
        verify(discoveryService, never()).snapshot(any(), any(), any(), any());
        verify(connectorAuthMapper, never()).markReauthRequiredForResource(any());
    }

    @Test
    void refreshRejectsSnapshotWhenDefinitionChangesDuringRemotePreview() {
        SsResource resource = ownedResource(99L, 42L);
        SsResExtMcp original = extension(99L, 3L, "fingerprint-a");
        SsResExtMcp changed = extension(99L, 4L, "fingerprint-b");
        UserMcpPublicConfig config = config("fingerprint-a", UserMcpAuthMode.NONE, null);
        List<UserMcpRemoteClient.RemoteTool> tools = List.of(
            new UserMcpRemoteClient.RemoteTool("search", "Search", "{\"type\":\"object\"}")
        );
        when(resourceService.findById(99L)).thenReturn(resource);
        when(extMcpService.findById(99L)).thenReturn(original);
        when(configParser.parse(original.getSourceContent())).thenReturn(config);
        when(discoveryService.preview(config, null)).thenReturn(tools);
        when(extMcpService.findByIdForUpdate(99L)).thenReturn(changed);

        assertThatThrownBy(() -> facade.refreshTools(99L, null, 42L))
            .isInstanceOf(IllegalStateException.class)
            .hasMessage("MCP_DEFINITION_CHANGED");
        verify(discoveryService, never()).snapshot(any(), any(), any(), any());
    }

    private UserMcpPublicConfig config(String fingerprint, UserMcpAuthMode mode, String credentialType) {
        return new UserMcpPublicConfig(
            "https://mcp.example.com",
            Transport.STREAMABLE_HTTP,
            "/mcp",
            URI.create("https://mcp.example.com/mcp"),
            new AuthProfile(mode, credentialType),
            20,
            fingerprint
        );
    }

    private SsResource ownedResource(Long resourceId, Long ownerId) {
        SsResource resource = new SsResource();
        resource.setResourceId(resourceId);
        resource.setResourceBizType("MCP");
        resource.setOwnerType("personal");
        resource.setCreateBy(ownerId);
        resource.setResourceCode("personal-search");
        resource.setResourceName("Personal Search");
        resource.setResourceStatus(2);
        return resource;
    }

    private SsResExtMcp extension(Long resourceId, Long revision, String fingerprint) {
        SsResExtMcp ext = new SsResExtMcp();
        ext.setResourceId(resourceId);
        ext.setDefinitionRevision(revision);
        ext.setEndpointFingerprint(fingerprint);
        ext.setSourceContent("{\"public\":true}");
        return ext;
    }

    private ConnectorAuth authorization(
            Long resourceId, Long revision, String fingerprint, String enableFlag, String credentialState) {
        ConnectorAuth auth = new ConnectorAuth();
        auth.setResourceId(resourceId);
        auth.setDefinitionRevision(revision);
        auth.setEndpointFingerprint(fingerprint);
        auth.setEnableFlag(enableFlag);
        auth.setCredentialState(credentialState);
        auth.setLastVerifiedAt(new Date(1_700_000_000_000L));
        auth.setStatusCd("00A");
        return auth;
    }
}
