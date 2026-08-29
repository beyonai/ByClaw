package com.iwhalecloud.byai.manager.application.service.devloop;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.Date;
import java.util.Optional;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.manager.application.service.job.DevloopPatService;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialSecret;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialSecretStore;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorConnectionStateService;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorInfoService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.entity.users.Users;

class GitHubCredentialResolverTest {

    private ConnectorInfoService connectorInfoService;
    private ConnectorConnectionStateService connectionStateService;
    private ConnectorCredentialSecretStore credentialSecretStore;
    private DevloopPatService patService;
    private UserService userService;
    private GitHubCredentialResolver resolver;

    @BeforeEach
    void setUp() {
        connectorInfoService = mock(ConnectorInfoService.class);
        connectionStateService = mock(ConnectorConnectionStateService.class);
        credentialSecretStore = mock(ConnectorCredentialSecretStore.class);
        patService = mock(DevloopPatService.class);
        userService = mock(UserService.class);
        resolver = new GitHubCredentialResolver(connectorInfoService, connectionStateService, credentialSecretStore,
            patService, userService);
    }

    @Test
    void prefersEnabledConnectorCredential() {
        ConnectorInfo connector = githubConnector();
        when(connectorInfoService.findByCode("github")).thenReturn(connector);
        when(connectionStateService.findEnabledActiveAuthorization("7", 11L))
            .thenReturn(readyAuth(null, "credential-ref"));
        when(credentialSecretStore.findActive("7", 11L, "github-oauth2")).thenReturn(Optional.of(
            ConnectorCredentialSecret.restored("credential-ref", "github-oauth2", "7", 11L, "oauth-token", null,
                null, null, null, null)));
        when(patService.getGitHubPat("7")).thenReturn("legacy-token");

        assertThat(resolver.resolve(7L)).isEqualTo("oauth-token");
    }

    @Test
    void fallsBackToLegacyTokenWhenConnectorIsUnavailable() {
        when(connectorInfoService.findByCode("github")).thenReturn(null);
        when(patService.getGitHubPat("7")).thenReturn("legacy-token");

        assertThat(resolver.resolve("7")).isEqualTo("legacy-token");
    }

    @Test
    void fallsBackWhenConnectorCredentialExpired() {
        ConnectorInfo connector = githubConnector();
        when(connectorInfoService.findByCode("github")).thenReturn(connector);
        when(connectionStateService.findEnabledActiveAuthorization("7", 11L))
            .thenReturn(readyAuth(null, "credential-ref"));
        when(credentialSecretStore.findActive("7", 11L, "github-oauth2")).thenReturn(Optional.of(
            ConnectorCredentialSecret.restored("credential-ref", "github-oauth2", "7", 11L, "expired-token", null,
                "bearer", "repo", new Date(System.currentTimeMillis() - 1000), null)));
        when(patService.getGitHubPat("7")).thenReturn("legacy-token");

        assertThat(resolver.resolve(7L)).isEqualTo("legacy-token");
    }

    @Test
    void fallsBackWhenActiveSecretDoesNotMatchAuthorizationBinding() {
        ConnectorInfo connector = githubConnector();
        when(connectorInfoService.findByCode("github")).thenReturn(connector);
        when(connectionStateService.findEnabledActiveAuthorization("7", 11L))
            .thenReturn(readyAuth(null, "bound-ref"));
        when(credentialSecretStore.findActive("7", 11L, "github-oauth2")).thenReturn(Optional.of(
            ConnectorCredentialSecret.restored("orphan-ref", "github-oauth2", "7", 11L, "orphan-token", null,
                null, null, null, null)));
        when(patService.getGitHubPat("7")).thenReturn("legacy-token");

        assertThat(resolver.resolve(7L)).isEqualTo("legacy-token");
    }

    @Test
    void resolvesUserCodeBeforeCredentialLookup() {
        Users user = new Users();
        user.setUserId(7L);
        when(userService.findByUserCode("00270001")).thenReturn(user);
        when(patService.getGitHubPat("7")).thenReturn("legacy-token");

        assertThat(resolver.resolveByUserCode("00270001")).isEqualTo("legacy-token");
    }

    private ConnectorInfo githubConnector() {
        ConnectorInfo connector = new ConnectorInfo();
        connector.setConnectorId(11L);
        connector.setConnectorCode("github");
        connector.setProviderCode("github-oauth2");
        connector.setStatusCd("00A");
        return connector;
    }

    private ConnectorAuth readyAuth(Date expiresAt, String credentialReference) {
        ConnectorAuth auth = new ConnectorAuth();
        auth.setEnableFlag("Y");
        auth.setStatusCd("00A");
        auth.setCredentialState("READY");
        auth.setAccessExpireTime(expiresAt);
        auth.setAuthCredential(Sm4Util.encrypt(JSON.toJSONString(
            java.util.Map.of("credentialReference", credentialReference))));
        return auth;
    }
}
