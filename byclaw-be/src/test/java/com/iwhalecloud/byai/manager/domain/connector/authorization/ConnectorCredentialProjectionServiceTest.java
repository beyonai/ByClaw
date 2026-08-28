package com.iwhalecloud.byai.manager.domain.connector.authorization;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.Date;
import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.manager.domain.connector.manifest.ConnectorManifestCanonicalizer.CredentialProjectionSpec;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorConnectionStateService;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorManifestService;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorAuthMapper;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorInfoMapper;

class ConnectorCredentialProjectionServiceTest {

    private static final Long USER_ID = 1001L;
    private static final Long CONNECTOR_ID = 2001L;
    private static final String PROJECTION_PATH = "/by/.connector-auth/.github/credential.json";

    @TempDir
    Path tempDir;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private ConnectorCredentialWorkspaceService workspaceService;
    private ConnectorCredentialSecretStore secretStore;
    private ConnectorConnectionStateService connectionStateService;
    private ConnectorManifestService manifestService;
    private ConnectorInfoMapper connectorInfoMapper;
    private ConnectorCredentialProjectionService service;
    private Path credentialFile;

    @BeforeEach
    void setUp() throws Exception {
        workspaceService = mock(ConnectorCredentialWorkspaceService.class);
        secretStore = mock(ConnectorCredentialSecretStore.class);
        connectionStateService = mock(ConnectorConnectionStateService.class);
        manifestService = mock(ConnectorManifestService.class);
        connectorInfoMapper = mock(ConnectorInfoMapper.class);
        credentialFile = Files.createDirectories(tempDir.resolve(".connector-auth/.github"))
            .resolve("credential.json");
        when(workspaceService.resolveProjectionFile(USER_ID, PROJECTION_PATH)).thenReturn(credentialFile);
        service = new ConnectorCredentialProjectionService(workspaceService, secretStore, connectionStateService,
            manifestService, connectorInfoMapper, mock(ConnectorAuthMapper.class), objectMapper);
    }

    @Test
    void syncWritesManifestDeclaredCredentialAtomically() throws Exception {
        ConnectorInfo connector = connector("github", "github-oauth2");
        stubProjection(connector);
        ConnectorAuth authorization = authorization("credential-ref");
        ConnectorCredentialSecret secret = ConnectorCredentialSecret.restored(
            "credential-ref", "github-oauth2", "1001", CONNECTOR_ID, "current-token", null, "bearer",
            "repo, read:user", null, null);
        when(connectionStateService.findEnabledActiveAuthorization("1001", CONNECTOR_ID)).thenReturn(authorization);
        when(secretStore.findActive("1001", CONNECTOR_ID, "github-oauth2")).thenReturn(Optional.of(secret));

        service.sync(USER_ID, connector);

        JsonNode json = objectMapper.readTree(credentialFile.toFile());
        assertThat(json.path("connectorCode").asText()).isEqualTo("github");
        assertThat(json.path("provider").asText()).isEqualTo("github");
        assertThat(json.path("providerCode").asText()).isEqualTo("github-oauth2");
        assertThat(json.path("credentialReference").asText()).isEqualTo("credential-ref");
        assertThat(json.path("accessToken").asText()).isEqualTo("current-token");
        assertThat(json.path("scopes").toString()).contains("read:user", "repo");
        if (Files.getFileAttributeView(credentialFile, java.nio.file.attribute.PosixFileAttributeView.class) != null) {
            assertThat(PosixFilePermissions.toString(Files.getPosixFilePermissions(credentialFile)))
                .isEqualTo("rw-------");
        }
        try (java.util.stream.Stream<Path> files = Files.list(credentialFile.getParent())) {
            assertThat(files.map(path -> path.getFileName().toString()).toList())
                .containsExactly("credential.json");
        }
    }

    @Test
    void projectionIsConnectorAgnosticAndUsesManifestPath() throws Exception {
        String path = "/by/.connector-auth/.custom/oauth.json";
        Path customFile = Files.createDirectories(tempDir.resolve(".connector-auth/.custom")).resolve("oauth.json");
        ConnectorInfo connector = connector("custom-oauth", "custom-provider");
        when(manifestService.credentialProjection(connector)).thenReturn(Optional.of(
            new CredentialProjectionSpec(path)));
        when(workspaceService.resolveProjectionFile(USER_ID, path)).thenReturn(customFile);
        when(connectionStateService.findEnabledActiveAuthorization("1001", CONNECTOR_ID))
            .thenReturn(authorization("custom-ref"));
        when(secretStore.findActive("1001", CONNECTOR_ID, "custom-provider")).thenReturn(Optional.of(
            ConnectorCredentialSecret.restored("custom-ref", "custom-provider", "1001", CONNECTOR_ID,
                "custom-token", null, null, null, null, null)));

        service.sync(USER_ID, connector);

        JsonNode json = objectMapper.readTree(customFile.toFile());
        assertThat(json.path("connectorCode").asText()).isEqualTo("custom-oauth");
        assertThat(json.path("accessToken").asText()).isEqualTo("custom-token");
    }

    @Test
    void syncDeletesProjectionWhenBindingReferenceDoesNotMatchActiveSecret() throws Exception {
        Files.writeString(credentialFile, "stale-token");
        ConnectorInfo connector = connector("github", "github-oauth2");
        stubProjection(connector);
        when(connectionStateService.findEnabledActiveAuthorization("1001", CONNECTOR_ID))
            .thenReturn(authorization("old-reference"));
        when(secretStore.findActive("1001", CONNECTOR_ID, "github-oauth2")).thenReturn(Optional.of(
            ConnectorCredentialSecret.restored("new-reference", "github-oauth2", "1001", CONNECTOR_ID,
                "new-token", null, null, null, null, null)));

        service.sync(USER_ID, connector);

        assertThat(credentialFile).doesNotExist();
    }

    @Test
    void deleteEventResolvesConnectorManifestAndRemovesExistingProjection() throws Exception {
        Files.writeString(credentialFile, "secret");
        ConnectorInfo connector = connector("github", "github-oauth2");
        stubProjection(connector);
        when(connectorInfoMapper.selectById(CONNECTOR_ID)).thenReturn(connector);

        service.handle(new ConnectorCredentialProjectionEvent(
            USER_ID, CONNECTOR_ID, ConnectorCredentialProjectionEvent.Action.DELETE));

        assertThat(credentialFile).doesNotExist();
    }

    private void stubProjection(ConnectorInfo connector) {
        when(manifestService.credentialProjection(connector)).thenReturn(Optional.of(
            new CredentialProjectionSpec(PROJECTION_PATH)));
    }

    private ConnectorInfo connector(String connectorCode, String providerCode) {
        ConnectorInfo connector = new ConnectorInfo();
        connector.setConnectorId(CONNECTOR_ID);
        connector.setConnectorCode(connectorCode);
        connector.setProviderCode(providerCode);
        connector.setStatusCd("00A");
        return connector;
    }

    private ConnectorAuth authorization(String reference) {
        ConnectorAuth authorization = new ConnectorAuth();
        authorization.setUserId("1001");
        authorization.setConnectorId(CONNECTOR_ID);
        authorization.setEnableFlag("Y");
        authorization.setStatusCd("00A");
        authorization.setAuthName("octocat");
        authorization.setAccessExpireTime(new Date(System.currentTimeMillis() + 60_000L));
        authorization.setAuthCredential(Sm4Util.encrypt("{\"credentialReference\":\"" + reference + "\"}"));
        return authorization;
    }
}
