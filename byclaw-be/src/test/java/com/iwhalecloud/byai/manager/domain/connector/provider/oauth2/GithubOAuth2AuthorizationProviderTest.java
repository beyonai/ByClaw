package com.iwhalecloud.byai.manager.domain.connector.provider.oauth2;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Date;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStartContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStartResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationCallback;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationSessionContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatusResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialState;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialSecretStore;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialSecret;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;

class GithubOAuth2AuthorizationProviderTest {
    @Test
    void startBuildsAuthorizationCodePkceRequestAndKeepsVerifierInProviderState() throws Exception {
        GithubOAuth2AuthorizationProvider provider = new GithubOAuth2AuthorizationProvider(
            mock(GithubOAuth2Client.class), mock(ConnectorCredentialSecretStore.class), new ObjectMapper(), name -> "secret"
        );
        String authorizationId = UUID.randomUUID().toString();
        AuthorizationStartContext context = new AuthorizationStartContext(
            authorizationId, "1001", 1003L, "github", "github-oauth2", "https://app.example/callback",
            Map.of("clientId", "client-1", "clientSecretEnv", "GITHUB_CLIENT_SECRET", "scope", "read:user",
                "redirectUri", "https://app.example/callback"), null
        );

        AuthorizationStartResult result = provider.start(context);

        assertThat(result.status()).isEqualTo(AuthorizationStatus.PENDING);
        assertThat(result.authorizationUrl()).startsWith("https://github.com/login/oauth/authorize?")
            .contains("client_id=client-1", "code_challenge_method=S256", "scope=read%3Auser");
        assertThat(result.providerState()).contains("codeVerifier", "oauthState", "redirectUri")
            .doesNotContain("secret");
        assertThat(result.providerSessionId()).isEqualTo(authorizationId);
        assertThat(result.providerSessionId()).doesNotContain(result.authorizationUrl().substring(
            result.authorizationUrl().indexOf("state=") + "state=".length()));
    }

    @Test
    void callbackExchangesCodeVerifiesUserAndStoresCredential() {
        GithubOAuth2Client client = mock(GithubOAuth2Client.class);
        ConnectorCredentialSecretStore store = mock(ConnectorCredentialSecretStore.class);
        GithubOAuth2AuthorizationProvider provider = new GithubOAuth2AuthorizationProvider(
            client, store, new ObjectMapper(), name -> "client-secret"
        );
        String authorizationId = UUID.randomUUID().toString();
        AuthorizationStartResult start = provider.start(new AuthorizationStartContext(
            authorizationId, "1001", 1003L, "github", "github-oauth2", "https://app.example/callback",
            Map.of("clientId", "client-1", "clientSecretEnv", "GITHUB_CLIENT_SECRET", "scope", "read:user",
                "redirectUri", "https://app.example/callback"), null
        ));
        when(client.exchange(org.mockito.ArgumentMatchers.any())).thenReturn(
            new GithubOAuth2Client.Token("access-token", null, "bearer", "read:user", null, null)
        );
        when(client.loadUser("access-token")).thenReturn(new GithubOAuth2Client.User("42", "octocat"));
        when(store.save(org.mockito.ArgumentMatchers.any())).thenReturn("credential-ref");

        AuthorizationStatusResult result = provider.handleCallback(
            new AuthorizationSessionContext(authorizationId, "1001", 1003L, "github", "github-oauth2",
                start.providerSessionId(), start.providerState(), start.expiresAt()),
            new AuthorizationCallback("temporary-code", oauthState(start), null, null)
        );

        assertThat(result.status()).isEqualTo(AuthorizationStatus.CONNECTED);
        assertThat(result.accountId()).isEqualTo("42");
        assertThat(result.accountName()).isEqualTo("octocat");
        assertThat(result.credentialReference()).isEqualTo("credential-ref");
        assertThat(result.credentialState()).isEqualTo(CredentialState.READY);
        verify(store).save(org.mockito.ArgumentMatchers.any());
    }

    @Test
    void revokeRemovesRemoteGrantBeforeSoftDeletingLocalCredential() {
        GithubOAuth2Client client = mock(GithubOAuth2Client.class);
        ConnectorCredentialSecretStore store = mock(ConnectorCredentialSecretStore.class);
        GithubOAuth2AuthorizationProvider provider = new GithubOAuth2AuthorizationProvider(
            client, store, new ObjectMapper(),
            name -> "GITHUB_CLIENT_ID".equals(name) ? "client-1" : "client-secret"
        );
        ConnectorCredentialSecret secret = ConnectorCredentialSecret.forOAuth2(
            "github-oauth2", "1001", 1003L, "access-token", null
        );
        when(store.findActive("1001", 1003L, "github-oauth2")).thenReturn(Optional.of(secret));
        ConnectorInfo connector = new ConnectorInfo();
        connector.setConnectorId(1003L);
        connector.setAuthConfig("{\"clientIdEnv\":\"GITHUB_CLIENT_ID\",\"clientSecretEnv\":\"GITHUB_CLIENT_SECRET\"}");

        provider.revoke("1001", connector);

        verify(client).revoke(new GithubOAuth2Client.RevokeRequest("client-1", "client-secret", "access-token"));
        verify(store).revoke(secret.credentialReference());
    }

    @Test
    void verifyProbesStoredCredentialAndReturnsConnectedAccount() {
        GithubOAuth2Client client = mock(GithubOAuth2Client.class);
        ConnectorCredentialSecretStore store = mock(ConnectorCredentialSecretStore.class);
        GithubOAuth2AuthorizationProvider provider = new GithubOAuth2AuthorizationProvider(
            client, store, new ObjectMapper(), name -> "secret"
        );
        ConnectorCredentialSecret secret = ConnectorCredentialSecret.forOAuth2(
            "github-oauth2", "1001", 1003L, "access-token", null
        );
        when(store.findActive("1001", 1003L, "github-oauth2")).thenReturn(Optional.of(secret));
        when(client.loadUser("access-token")).thenReturn(new GithubOAuth2Client.User("42", "octocat"));
        ConnectorInfo connector = new ConnectorInfo();
        connector.setConnectorId(1003L);

        AuthorizationStatusResult result = provider.verify(1001L, connector);

        assertThat(result.status()).isEqualTo(AuthorizationStatus.CONNECTED);
        assertThat(result.accountName()).isEqualTo("octocat");
        assertThat(result.credentialReference()).isEqualTo(secret.credentialReference());
    }

    @Test
    void cleanupProvisionalCredentialRevokesOnlyTheCredentialCreatedForTheSession() {
        GithubOAuth2Client client = mock(GithubOAuth2Client.class);
        ConnectorCredentialSecretStore store = mock(ConnectorCredentialSecretStore.class);
        GithubOAuth2AuthorizationProvider provider = new GithubOAuth2AuthorizationProvider(
            client, store, new ObjectMapper(), name -> "client-secret"
        );
        ConnectorCredentialSecret secret = ConnectorCredentialSecret.forOAuth2(
            "github-oauth2", "1001", 1003L, "access-token", null
        );
        when(store.findActive("1001", 1003L, "github-oauth2")).thenReturn(Optional.of(secret));
        AuthorizationSessionContext session = new AuthorizationSessionContext(
            UUID.randomUUID().toString(), "1001", 1003L, "github", "github-oauth2", "provider-session",
            "{\"clientId\":\"client-1\",\"clientSecretEnv\":\"GITHUB_CLIENT_SECRET\"}", new Date()
        );

        provider.cleanupProvisionalCredential(session, secret.credentialReference());

        verify(client).revoke(new GithubOAuth2Client.RevokeRequest(
            "client-1", "client-secret", "access-token"));
        verify(store).revoke(secret.credentialReference());
    }

    @Test
    void callbackRejectsTokenWhenGrantedScopesAreInsufficient() {
        GithubOAuth2Client client = mock(GithubOAuth2Client.class);
        ConnectorCredentialSecretStore store = mock(ConnectorCredentialSecretStore.class);
        GithubOAuth2AuthorizationProvider provider = new GithubOAuth2AuthorizationProvider(
            client, store, new ObjectMapper(), name -> "client-secret"
        );
        String authorizationId = UUID.randomUUID().toString();
        AuthorizationStartResult start = provider.start(new AuthorizationStartContext(
            authorizationId, "1001", 1003L, "github", "github-oauth2", "https://app.example/callback",
            Map.of("clientId", "client-1", "clientSecretEnv", "GITHUB_CLIENT_SECRET", "scope", "read:user repo",
                "redirectUri", "https://app.example/callback"), null
        ));
        when(client.exchange(org.mockito.ArgumentMatchers.any())).thenReturn(
            new GithubOAuth2Client.Token("access-token", null, "bearer", "read:user", null, null)
        );

        AuthorizationStatusResult result = provider.handleCallback(
            new AuthorizationSessionContext(authorizationId, "1001", 1003L, "github", "github-oauth2",
                start.providerSessionId(), start.providerState(), start.expiresAt()),
            new AuthorizationCallback("temporary-code", oauthState(start), null, null)
        );

        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.errorCode()).isEqualTo("OAUTH_SCOPE_INSUFFICIENT");
        org.mockito.Mockito.verifyNoInteractions(store);
    }

    @Test
    void callbackRejectsMissingStateWithoutCallingGithub() {
        GithubOAuth2Client client = mock(GithubOAuth2Client.class);
        GithubOAuth2AuthorizationProvider provider = new GithubOAuth2AuthorizationProvider(
            client, mock(ConnectorCredentialSecretStore.class), new ObjectMapper(), name -> "client-secret"
        );
        String authorizationId = UUID.randomUUID().toString();
        AuthorizationStartResult start = provider.start(new AuthorizationStartContext(
            authorizationId, "1001", 1003L, "github", "github-oauth2", "https://app.example/callback",
            Map.of("clientId", "client-1", "clientSecretEnv", "GITHUB_CLIENT_SECRET", "scope", "read:user",
                "redirectUri", "https://app.example/callback"), null
        ));

        AuthorizationStatusResult result = provider.handleCallback(
            new AuthorizationSessionContext(authorizationId, "1001", 1003L, "github", "github-oauth2",
                start.providerSessionId(), start.providerState(), start.expiresAt()),
            new AuthorizationCallback("temporary-code", null, null, null)
        );

        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.errorCode()).isEqualTo("OAUTH_STATE_INVALID");
        org.mockito.Mockito.verifyNoInteractions(client);
    }

    @Test
    void startUsesConfiguredCallbackInsteadOfFrontendReturnUrl() {
        GithubOAuth2AuthorizationProvider provider = new GithubOAuth2AuthorizationProvider(
            mock(GithubOAuth2Client.class), mock(ConnectorCredentialSecretStore.class), new ObjectMapper(), name -> "secret"
        );
        AuthorizationStartContext context = new AuthorizationStartContext(
            UUID.randomUUID().toString(), "1001", 1003L, "github", "github-oauth2", "https://evil.example/callback",
            Map.of("clientId", "client-1", "clientSecretEnv", "GITHUB_CLIENT_SECRET", "scope", "read:user",
                "redirectUri", "https://app.example/callback"), null
        );

        AuthorizationStartResult result = provider.start(context);

        assertThat(result.status()).isEqualTo(AuthorizationStatus.PENDING);
        assertThat(result.authorizationUrl()).contains("redirect_uri=https%3A%2F%2Fapp.example%2Fcallback");
    }

    @Test
    void startReportsIncompleteOAuthAppConfiguration() {
        GithubOAuth2AuthorizationProvider provider = new GithubOAuth2AuthorizationProvider(
            mock(GithubOAuth2Client.class), mock(ConnectorCredentialSecretStore.class), new ObjectMapper(),
            name -> {
                throw new IllegalStateException("missing environment value");
            }
        );
        AuthorizationStartContext context = new AuthorizationStartContext(
            UUID.randomUUID().toString(), "1001", 1003L, "github", "github-oauth2", "http://localhost:8000/chat",
            Map.of("clientIdEnv", "GITHUB_OAUTH_CLIENT_ID", "clientSecretEnv", "GITHUB_OAUTH_CLIENT_SECRET",
                "scope", "read:user repo", "redirectUriEnv", "GITHUB_OAUTH_REDIRECT_URI"), null
        );

        AuthorizationStartResult result = provider.start(context);

        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.errorCode()).isEqualTo("OAUTH_PROVIDER_CONFIG_INVALID");
        assertThat(result.errorMessage()).isEqualTo("GitHub OAuth2未配置完整，请联系管理员");
    }

    @Test
    void startAllowsHttpCallbackForExistingNonTlsDeployments() {
        GithubOAuth2AuthorizationProvider provider = new GithubOAuth2AuthorizationProvider(
            mock(GithubOAuth2Client.class), mock(ConnectorCredentialSecretStore.class), new ObjectMapper(), name -> "secret"
        );
        AuthorizationStartContext context = new AuthorizationStartContext(
            UUID.randomUUID().toString(), "1001", 1003L, "github", "github-oauth2", "http://localhost:8000/chat",
            Map.of("clientId", "client-1", "clientSecretEnv", "GITHUB_CLIENT_SECRET", "scope", "read:user",
                "redirectUri", "http://localhost:8000/byaiService/connector/authorization/callback/github-oauth2"), null
        );

        AuthorizationStartResult result = provider.start(context);

        assertThat(result.status()).isEqualTo(AuthorizationStatus.PENDING);
        assertThat(result.authorizationUrl()).contains("redirect_uri=http%3A%2F%2Flocalhost%3A8000%2FbyaiService%2Fconnector");
    }

    private String oauthState(AuthorizationStartResult start) {
        try {
            return new ObjectMapper().readTree(start.providerState()).path("oauthState").asText();
        } catch (Exception e) {
            throw new AssertionError(e);
        }
    }
}
