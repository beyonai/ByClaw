package com.iwhalecloud.byai.manager.domain.usermcp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.net.URI;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import com.iwhalecloud.byai.manager.domain.usermcp.UserMcpPublicConfig.AuthProfile;
import com.iwhalecloud.byai.manager.domain.usermcp.UserMcpPublicConfig.Transport;
import com.iwhalecloud.byai.manager.entity.resource.UserMcpToolSnapshot;
import com.iwhalecloud.byai.manager.mapper.resource.UserMcpToolSnapshotMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

@ExtendWith(MockitoExtension.class)
class UserMcpToolDiscoveryServiceTest {

    @Mock
    private UserMcpRemoteClient remoteClient;

    @Mock
    private UserMcpToolSnapshotMapper snapshotMapper;

    @Mock
    private SequenceService sequenceService;

    private UserMcpToolDiscoveryService service;

    @BeforeEach
    void setUp() {
        service = new UserMcpToolDiscoveryService(remoteClient, snapshotMapper, sequenceService);
    }

    @Test
    void defaultsEveryDiscoveredToolToRead() {
        UserMcpPublicConfig config = config();
        when(remoteClient.discover(config, null)).thenReturn(List.of(
            new UserMcpRemoteClient.RemoteTool("search", "Search records", "{\"type\":\"object\"}"),
            new UserMcpRemoteClient.RemoteTool("publish", "Publish record", "{\"type\":\"object\"}")
        ));
        when(sequenceService.nextVal()).thenReturn(700L, 701L, 702L);

        UserMcpToolDiscoveryService.DiscoveryResult result = service.discoverAndSnapshot(9L, 3L, config, null);

        assertThat(result.snapshotVersion()).isEqualTo(700L);
        assertThat(result.tools()).extracting(UserMcpToolDiscoveryService.ToolView::name)
            .containsExactly("search", "publish");
        verify(snapshotMapper).deactivateActive(9L);
        ArgumentCaptor<UserMcpToolSnapshot> captor = ArgumentCaptor.forClass(UserMcpToolSnapshot.class);
        verify(snapshotMapper, org.mockito.Mockito.times(2)).insert(captor.capture());
        assertThat(captor.getAllValues()).allSatisfy(snapshot -> {
            assertThat(snapshot.getResourceId()).isEqualTo(9L);
            assertThat(snapshot.getDefinitionRevision()).isEqualTo(3L);
            assertThat(snapshot.getSnapshotVersion()).isEqualTo(700L);
            assertThat(snapshot.getSchemaHash()).hasSize(64);
        });
        assertThat(captor.getAllValues()).extracting(UserMcpToolSnapshot::getRiskLevel)
            .containsExactly("READ", "READ");
        assertThat(captor.getAllValues()).extracting(UserMcpToolSnapshot::getRiskSource)
            .containsOnly("SYSTEM_DEFAULT");
        assertThat(result.tools()).extracting(UserMcpToolDiscoveryService.ToolView::riskLevel)
            .containsExactly("READ", "READ");
    }

    @Test
    void rejectsEmptyOrOversizedCatalogBeforeChangingSnapshot() {
        UserMcpPublicConfig config = config();
        when(remoteClient.discover(config, null)).thenReturn(List.of());

        assertThatThrownBy(() -> service.discoverAndSnapshot(9L, 3L, config, null))
            .isInstanceOf(IllegalArgumentException.class);
        verify(snapshotMapper, never()).deactivateActive(any());

        when(remoteClient.discover(config, null)).thenReturn(List.of(
            new UserMcpRemoteClient.RemoteTool("large", "Large", "x".repeat(65_537))
        ));
        assertThatThrownBy(() -> service.discoverAndSnapshot(9L, 3L, config, null))
            .isInstanceOf(IllegalArgumentException.class);
        verify(snapshotMapper, never()).insert(any());
    }

    private UserMcpPublicConfig config() {
        return new UserMcpPublicConfig(
            "https://mcp.example.com",
            Transport.STREAMABLE_HTTP,
            "/mcp",
            URI.create("https://mcp.example.com/mcp"),
            new AuthProfile(UserMcpAuthMode.NONE, null),
            20,
            "fingerprint"
        );
    }
}
