package com.iwhalecloud.byai.manager.domain.connector.provider.oauth2;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.Date;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationCallback;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationSessionContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStartContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStartResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatusResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialSecret;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialSecretStore;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialRenewalMode;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;

class MailOAuth2AuthorizationProviderTest {
    private static final String GMAIL_SCOPE =
        "openid email https://www.googleapis.com/auth/gmail.modify";
    private static final String MICROSOFT_SCOPE =
        "openid profile email offline_access User.Read Mail.ReadWrite Mail.Send";

    @Test
    void gmailStartUsesFixedEndpointPkceAndOfflineConsent() throws Exception {
        GmailOAuth2AuthorizationProvider provider = gmail(mock(MailOAuth2Client.class),
            mock(ConnectorCredentialSecretStore.class), name -> env(name));

        AuthorizationStartResult result = provider.start(context("gmail-oauth2", gmailConfig(), GMAIL_SCOPE));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.PENDING);
        assertThat(result.authorizationUrl())
            .startsWith("https://accounts.google.com/o/oauth2/v2/auth?")
            .contains("code_challenge_method=S256", "access_type=offline", "prompt=consent",
                "scope=openid+email+https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fgmail.modify")
            .doesNotContain("client-secret");
        assertThat(result.providerState()).contains("codeVerifier", "oauthState").doesNotContain("client-secret");
    }

    @Test
    void gmailStartRejectsConfigurationMissingGmailModify() {
        GmailOAuth2AuthorizationProvider provider = gmail(mock(MailOAuth2Client.class),
            mock(ConnectorCredentialSecretStore.class), name -> env(name));
        Map<String, Object> weakened = new java.util.LinkedHashMap<>(gmailConfig());
        weakened.put("scope", "openid email");

        AuthorizationStartResult result = provider.start(context("gmail-oauth2", weakened, "openid email"));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.errorCode()).isEqualTo("OAUTH_PROVIDER_CONFIG_INVALID");
    }

    @Test
    void microsoftStartUsesCommonEndpointAndRequestedScopes() {
        MicrosoftMailOAuth2AuthorizationProvider provider = microsoft(mock(MailOAuth2Client.class),
            mock(ConnectorCredentialSecretStore.class), name -> env(name));

        AuthorizationStartResult result = provider.start(context(
            "microsoft-mail-oauth2", microsoftConfig(), MICROSOFT_SCOPE));

        assertThat(result.authorizationUrl())
            .startsWith("https://login.microsoftonline.com/common/oauth2/v2.0/authorize?")
            .contains("scope=openid+profile+email+offline_access+User.Read+Mail.ReadWrite+Mail.Send")
            .doesNotContain("access_type=", "prompt=consent");
    }

    @Test
    void microsoftStartRejectsConfigurationMissingRequiredMailScope() {
        MicrosoftMailOAuth2AuthorizationProvider provider = microsoft(mock(MailOAuth2Client.class),
            mock(ConnectorCredentialSecretStore.class), name -> env(name));
        Map<String, Object> weakened = new java.util.LinkedHashMap<>(microsoftConfig());
        weakened.put("scope", "openid profile email offline_access User.Read Mail.ReadWrite");

        AuthorizationStartResult result = provider.start(context(
            "microsoft-mail-oauth2", weakened, weakened.get("scope").toString()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.errorCode()).isEqualTo("OAUTH_PROVIDER_CONFIG_INVALID");
    }

    @Test
    void startFailsSafelyWhenDeploymentEnvironmentIsMissing() {
        GmailOAuth2AuthorizationProvider provider = gmail(mock(MailOAuth2Client.class),
            mock(ConnectorCredentialSecretStore.class), name -> {
                throw new IllegalStateException("deployment details");
            });

        AuthorizationStartResult result = provider.start(context("gmail-oauth2", gmailConfig(), GMAIL_SCOPE));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.errorCode()).isEqualTo("OAUTH_PROVIDER_CONFIG_INVALID");
        assertThat(result.errorMessage()).isEqualTo("Gmail OAuth2未配置完整，请联系管理员");
        assertThat(result.errorMessage()).doesNotContain("deployment details");
    }

    @Test
    void deniedCallbackReturnsSafeCanonicalError() {
        MailOAuth2Client client = mock(MailOAuth2Client.class);
        GmailOAuth2AuthorizationProvider provider = gmail(client, mock(ConnectorCredentialSecretStore.class),
            name -> env(name));
        AuthorizationStartResult start = provider.start(context("gmail-oauth2", gmailConfig(), GMAIL_SCOPE));

        AuthorizationStatusResult result = provider.handleCallback(session(start, "gmail-oauth2"),
            new AuthorizationCallback(null, oauthState(start), "access_denied", "provider body with token"));

        assertThat(result.errorCode()).isEqualTo("OAUTH_DENIED");
        assertThat(result.errorMessage()).isEqualTo("用户拒绝或平台取消授权");
        verifyNoInteractions(client);
    }

    @Test
    void callbackRejectsStateMismatchBeforeExchange() {
        MailOAuth2Client client = mock(MailOAuth2Client.class);
        GmailOAuth2AuthorizationProvider provider = gmail(client, mock(ConnectorCredentialSecretStore.class),
            name -> env(name));
        AuthorizationStartResult start = provider.start(context("gmail-oauth2", gmailConfig(), GMAIL_SCOPE));

        AuthorizationStatusResult result = provider.handleCallback(session(start, "gmail-oauth2"),
            new AuthorizationCallback("code", "wrong-state", null, null));

        assertThat(result.errorCode()).isEqualTo("OAUTH_STATE_INVALID");
        verifyNoInteractions(client);
    }

    @Test
    void gmailAcceptsMissingScopeAfterSuccessfulProfileAndStoresRequestedScopes() {
        MailOAuth2Client client = mock(MailOAuth2Client.class);
        ConnectorCredentialSecretStore store = mock(ConnectorCredentialSecretStore.class);
        GmailOAuth2AuthorizationProvider provider = gmail(client, store, name -> env(name));
        AuthorizationStartResult start = provider.start(context("gmail-oauth2", gmailConfig(), GMAIL_SCOPE));
        when(client.exchange(any())).thenReturn(new MailOAuth2Client.Token(
            "access", "refresh", "Bearer", null, new Date(10_000L), null));
        when(client.loadProfile(MailOAuth2Client.Provider.GMAIL, "access"))
            .thenReturn(new MailOAuth2Client.Profile("user@example.com", "user@example.com", Map.of()));
        when(store.save(any())).thenReturn("credential-ref");

        AuthorizationStatusResult result = provider.handleCallback(session(start, "gmail-oauth2"),
            new AuthorizationCallback("code", oauthState(start), null, null));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.CONNECTED);
        assertThat(result.renewalMode()).isEqualTo(CredentialRenewalMode.REFRESH_TOKEN);
        var secret = org.mockito.ArgumentCaptor.forClass(ConnectorCredentialSecret.class);
        verify(store).save(secret.capture());
        assertThat(secret.getValue().grantedScopes()).isEqualTo(GMAIL_SCOPE);
    }

    @Test
    void gmailRejectsMissingRefreshTokenInsteadOfFallingBackToCredentialReissue() {
        MailOAuth2Client client = mock(MailOAuth2Client.class);
        ConnectorCredentialSecretStore store = mock(ConnectorCredentialSecretStore.class);
        GmailOAuth2AuthorizationProvider provider = gmail(client, store, name -> env(name));
        AuthorizationStartResult start = provider.start(context("gmail-oauth2", gmailConfig(), GMAIL_SCOPE));
        when(client.exchange(any())).thenReturn(new MailOAuth2Client.Token(
            "access", null, "Bearer", null, new Date(), null));
        when(client.loadProfile(MailOAuth2Client.Provider.GMAIL, "access"))
            .thenReturn(new MailOAuth2Client.Profile("user@example.com", "user@example.com", Map.of()));
        when(store.save(any())).thenReturn("credential-ref");

        AuthorizationStatusResult result = provider.handleCallback(session(start, "gmail-oauth2"),
            new AuthorizationCallback("code", oauthState(start), null, null));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.errorCode()).isEqualTo("OAUTH_TOKEN_EXCHANGE_FAILED");
        assertThat(result.renewalMode()).isNotEqualTo(CredentialRenewalMode.CREDENTIAL_REISSUE);
        verifyNoInteractions(store);
    }

    @Test
    void microsoftRejectsInsufficientGrantedScopes() {
        MailOAuth2Client client = mock(MailOAuth2Client.class);
        ConnectorCredentialSecretStore store = mock(ConnectorCredentialSecretStore.class);
        MicrosoftMailOAuth2AuthorizationProvider provider = microsoft(client, store, name -> env(name));
        AuthorizationStartResult start = provider.start(context(
            "microsoft-mail-oauth2", microsoftConfig(), MICROSOFT_SCOPE));
        when(client.exchange(any())).thenReturn(new MailOAuth2Client.Token(
            "access", "refresh", "Bearer", "openid email", new Date(), null));

        AuthorizationStatusResult result = provider.handleCallback(session(start, "microsoft-mail-oauth2"),
            new AuthorizationCallback("code", oauthState(start), null, null));

        assertThat(result.errorCode()).isEqualTo("OAUTH_SCOPE_INSUFFICIENT");
        verifyNoInteractions(store);
    }

    @Test
    void microsoftAcceptsResourceScopesWithoutOfflineAccessWhenRefreshTokenExists() {
        MailOAuth2Client client = mock(MailOAuth2Client.class);
        ConnectorCredentialSecretStore store = mock(ConnectorCredentialSecretStore.class);
        MicrosoftMailOAuth2AuthorizationProvider provider = microsoft(client, store, name -> env(name));
        AuthorizationStartResult start = provider.start(context(
            "microsoft-mail-oauth2", microsoftConfig(), MICROSOFT_SCOPE));
        when(client.exchange(any())).thenReturn(new MailOAuth2Client.Token(
            "access", "refresh", "Bearer", "openid profile email User.Read Mail.ReadWrite Mail.Send",
            new Date(), null));
        when(client.loadProfile(MailOAuth2Client.Provider.MICROSOFT, "access")).thenReturn(
            new MailOAuth2Client.Profile("id-1", "mail@example.com", Map.of()));
        when(store.save(any())).thenReturn("credential-ref");

        AuthorizationStatusResult result = provider.handleCallback(session(start, "microsoft-mail-oauth2"),
            new AuthorizationCallback("code", oauthState(start), null, null));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.CONNECTED);
        assertThat(result.renewalMode()).isEqualTo(CredentialRenewalMode.REFRESH_TOKEN);
        verify(store).save(any());
    }

    @Test
    void microsoftAcceptsResourceOnlyTokenScope() {
        MailOAuth2Client client = mock(MailOAuth2Client.class);
        ConnectorCredentialSecretStore store = mock(ConnectorCredentialSecretStore.class);
        MicrosoftMailOAuth2AuthorizationProvider provider = microsoft(client, store, name -> env(name));
        AuthorizationStartResult start = provider.start(context(
            "microsoft-mail-oauth2", microsoftConfig(), MICROSOFT_SCOPE));
        when(client.exchange(any())).thenReturn(new MailOAuth2Client.Token(
            "access", "refresh", "Bearer", "User.Read Mail.ReadWrite Mail.Send", new Date(), null));
        when(client.loadProfile(MailOAuth2Client.Provider.MICROSOFT, "access")).thenReturn(
            new MailOAuth2Client.Profile("id", "mail@example.com", Map.of()));
        when(store.save(any())).thenReturn("ref");

        AuthorizationStatusResult result = provider.handleCallback(session(start, "microsoft-mail-oauth2"),
            new AuthorizationCallback("code", oauthState(start), null, null));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.CONNECTED);
    }

    @Test
    void microsoftUsesRequestedScopesWhenTokenResponseOmitsScope() {
        MailOAuth2Client client = mock(MailOAuth2Client.class);
        ConnectorCredentialSecretStore store = mock(ConnectorCredentialSecretStore.class);
        MicrosoftMailOAuth2AuthorizationProvider provider = microsoft(client, store, name -> env(name));
        AuthorizationStartResult start = provider.start(context(
            "microsoft-mail-oauth2", microsoftConfig(), MICROSOFT_SCOPE));
        when(client.exchange(any())).thenReturn(new MailOAuth2Client.Token(
            "access", "refresh", "Bearer", null, new Date(), null));
        when(client.loadProfile(MailOAuth2Client.Provider.MICROSOFT, "access")).thenReturn(
            new MailOAuth2Client.Profile("id", "mail@example.com", Map.of()));
        when(store.save(any())).thenReturn("ref");

        AuthorizationStatusResult result = provider.handleCallback(session(start, "microsoft-mail-oauth2"),
            new AuthorizationCallback("code", oauthState(start), null, null));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.CONNECTED);
        var saved = org.mockito.ArgumentCaptor.forClass(ConnectorCredentialSecret.class);
        verify(store).save(saved.capture());
        assertThat(saved.getValue().grantedScopes()).isEqualTo(MICROSOFT_SCOPE);
    }

    @Test
    void gmailRejectsExplicitDowngradedTokenScope() {
        MailOAuth2Client client = mock(MailOAuth2Client.class);
        ConnectorCredentialSecretStore store = mock(ConnectorCredentialSecretStore.class);
        GmailOAuth2AuthorizationProvider provider = gmail(client, store, name -> env(name));
        AuthorizationStartResult start = provider.start(context("gmail-oauth2", gmailConfig(), GMAIL_SCOPE));
        when(client.exchange(any())).thenReturn(new MailOAuth2Client.Token(
            "access", "refresh", "Bearer", "openid email", new Date(), null));

        AuthorizationStatusResult result = provider.handleCallback(session(start, "gmail-oauth2"),
            new AuthorizationCallback("code", oauthState(start), null, null));

        assertThat(result.errorCode()).isEqualTo("OAUTH_SCOPE_INSUFFICIENT");
        verifyNoInteractions(store);
    }

    @Test
    void redirectPolicyAllowsOnlyHttpsOrLoopbackHttp() {
        GmailOAuth2AuthorizationProvider provider = gmail(mock(MailOAuth2Client.class),
            mock(ConnectorCredentialSecretStore.class), name -> switch (name) {
                case "GMAIL_OAUTH_CLIENT_ID" -> "client";
                case "GMAIL_OAUTH_CLIENT_SECRET" -> "secret";
                case "GMAIL_OAUTH_REDIRECT_URI" -> "http://evil.example/callback";
                default -> throw new IllegalStateException();
            });
        assertThat(provider.start(context("gmail-oauth2", gmailConfig(), GMAIL_SCOPE)).status())
            .isEqualTo(AuthorizationStatus.FAILED);

        for (String invalid : java.util.List.of("https://user@safe.example/cb", "https://safe.example/cb#fragment",
                "ftp://safe.example/cb")) {
            GmailOAuth2AuthorizationProvider invalidProvider = gmail(mock(MailOAuth2Client.class),
                mock(ConnectorCredentialSecretStore.class), name -> name.endsWith("REDIRECT_URI") ? invalid : "value");
            assertThat(invalidProvider.start(context("gmail-oauth2", gmailConfig(), GMAIL_SCOPE)).status())
                .isEqualTo(AuthorizationStatus.FAILED);
        }
        for (String loopback : java.util.List.of("http://localhost/cb", "http://127.0.0.1/cb", "http://[::1]/cb")) {
            GmailOAuth2AuthorizationProvider valid = gmail(mock(MailOAuth2Client.class),
                mock(ConnectorCredentialSecretStore.class), name -> name.endsWith("REDIRECT_URI") ? loopback : "value");
            assertThat(valid.start(context("gmail-oauth2", gmailConfig(), GMAIL_SCOPE)).status())
                .isEqualTo(AuthorizationStatus.PENDING);
        }
    }

    @Test
    void microsoftRejectsMissingMailSendScopeEvenWhenRefreshTokenExists() {
        MailOAuth2Client client = mock(MailOAuth2Client.class);
        ConnectorCredentialSecretStore store = mock(ConnectorCredentialSecretStore.class);
        MicrosoftMailOAuth2AuthorizationProvider provider = microsoft(client, store, name -> env(name));
        AuthorizationStartResult start = provider.start(context(
            "microsoft-mail-oauth2", microsoftConfig(), MICROSOFT_SCOPE));
        when(client.exchange(any())).thenReturn(new MailOAuth2Client.Token(
            "access", "refresh", "Bearer", "openid profile email User.Read Mail.ReadWrite",
            new Date(), null));

        AuthorizationStatusResult result = provider.handleCallback(session(start, "microsoft-mail-oauth2"),
            new AuthorizationCallback("code", oauthState(start), null, null));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.errorCode()).isEqualTo("OAUTH_SCOPE_INSUFFICIENT");
        verifyNoInteractions(store);
    }

    @Test
    void microsoftRejectsMissingRefreshTokenInsteadOfClaimingRefreshRenewal() {
        MailOAuth2Client client = mock(MailOAuth2Client.class);
        ConnectorCredentialSecretStore store = mock(ConnectorCredentialSecretStore.class);
        MicrosoftMailOAuth2AuthorizationProvider provider = microsoft(client, store, name -> env(name));
        AuthorizationStartResult start = provider.start(context(
            "microsoft-mail-oauth2", microsoftConfig(), MICROSOFT_SCOPE));
        when(client.exchange(any())).thenReturn(new MailOAuth2Client.Token(
            "access", null, "Bearer", "openid profile email User.Read Mail.ReadWrite Mail.Send",
            new Date(), null));

        AuthorizationStatusResult result = provider.handleCallback(session(start, "microsoft-mail-oauth2"),
            new AuthorizationCallback("code", oauthState(start), null, null));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.errorCode()).isEqualTo("OAUTH_TOKEN_EXCHANGE_FAILED");
        verifyNoInteractions(store);
    }

    @Test
    void verifyReturnsWhitelistedMicrosoftProfileAttributes() {
        MailOAuth2Client client = mock(MailOAuth2Client.class);
        ConnectorCredentialSecretStore store = mock(ConnectorCredentialSecretStore.class);
        MicrosoftMailOAuth2AuthorizationProvider provider = microsoft(client, store, name -> env(name));
        ConnectorCredentialSecret secret = ConnectorCredentialSecret.forOAuth2(
            "microsoft-mail-oauth2", "1001", 9L, "access", "refresh");
        when(store.findActive("1001", 9L, "microsoft-mail-oauth2")).thenReturn(Optional.of(secret));
        when(client.loadProfile(MailOAuth2Client.Provider.MICROSOFT, "access")).thenReturn(
            new MailOAuth2Client.Profile("id-1", "mail@example.com",
                Map.of("principalName", "upn@example.com", "ignored", "secret-data")));
        ConnectorInfo connector = new ConnectorInfo();
        connector.setConnectorId(9L);

        AuthorizationStatusResult result = provider.verify(1001L, connector);

        assertThat(result.accountName()).isEqualTo("mail@example.com");
        assertThat(result.accountAttributes()).containsOnlyKeys("principalName");
    }

    @Test
    void microsoftRevokeOnlyRemovesLocalSecret() {
        MailOAuth2Client client = mock(MailOAuth2Client.class);
        ConnectorCredentialSecretStore store = mock(ConnectorCredentialSecretStore.class);
        MicrosoftMailOAuth2AuthorizationProvider provider = microsoft(client, store, name -> env(name));
        ConnectorCredentialSecret secret = ConnectorCredentialSecret.forOAuth2(
            "microsoft-mail-oauth2", "1001", 9L, "access", "refresh");
        when(store.findActive("1001", 9L, "microsoft-mail-oauth2")).thenReturn(Optional.of(secret));
        ConnectorInfo connector = new ConnectorInfo();
        connector.setConnectorId(9L);

        provider.revoke("1001", connector);

        verify(store).revoke(secret.credentialReference());
        verifyNoInteractions(client);
    }

    @Test
    void renewalPreservesOldRefreshTokenWhenProviderOmitsIt() {
        assertRefreshTokenReplacement(null, "old-refresh");
    }

    @Test
    void renewalRotatesRefreshTokenWhenProviderReturnsNewValue() {
        assertRefreshTokenReplacement("rotated-refresh", "rotated-refresh");
    }

    @Test
    void renewalRejectsDowngradedGrantedScopesBeforeReplacingSecret() {
        MailOAuth2Client client = mock(MailOAuth2Client.class);
        ConnectorCredentialSecretStore store = mock(ConnectorCredentialSecretStore.class);
        MicrosoftMailOAuth2AuthorizationProvider provider = microsoft(client, store, name -> env(name));
        ConnectorCredentialSecret old = ConnectorCredentialSecret.restored("credential-ref",
            "microsoft-mail-oauth2", "1001", 9L, "old-access", "old-refresh", "Bearer",
            MICROSOFT_SCOPE, new Date(), new Date(System.currentTimeMillis() + 60_000L));
        when(store.findActive("1001", 9L, "microsoft-mail-oauth2")).thenReturn(Optional.of(old));
        when(client.refresh(any())).thenReturn(new MailOAuth2Client.Token("new-access", null, "Bearer",
            "openid profile email offline_access User.Read", new Date(), null));
        ConnectorInfo connector = new ConnectorInfo();
        connector.setConnectorId(9L);
        connector.setAuthConfig("{\"clientIdEnv\":\"MICROSOFT_OAUTH_CLIENT_ID\","
            + "\"clientSecretEnv\":\"MICROSOFT_OAUTH_CLIENT_SECRET\"}");

        AuthorizationStatusResult result = provider.renew(1001L, connector);

        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.errorCode()).isEqualTo("OAUTH_REFRESH_UNAVAILABLE");
        org.mockito.Mockito.verify(store, org.mockito.Mockito.never()).replace(any(), any(), any());
    }

    @Test
    void renewalMapsTypedTransientAndPermanentClientFailures() {
        MailOAuth2Client client = mock(MailOAuth2Client.class);
        ConnectorCredentialSecretStore store = mock(ConnectorCredentialSecretStore.class);
        GmailOAuth2AuthorizationProvider provider = gmail(client, store, name -> env(name));
        ConnectorCredentialSecret old = ConnectorCredentialSecret.restored("ref", "gmail-oauth2", "1001", 9L,
            "old", "refresh", "Bearer", GMAIL_SCOPE, new Date(), new Date(System.currentTimeMillis() + 60_000L));
        when(store.findActive("1001", 9L, "gmail-oauth2")).thenReturn(Optional.of(old));
        ConnectorInfo connector = new ConnectorInfo();
        connector.setConnectorId(9L);
        connector.setAuthConfig("{\"clientIdEnv\":\"GMAIL_OAUTH_CLIENT_ID\","
            + "\"clientSecretEnv\":\"GMAIL_OAUTH_CLIENT_SECRET\"}");
        when(client.refresh(any()))
            .thenThrow(new MailOAuth2ClientException("HTTP_RETRYABLE", true))
            .thenThrow(new MailOAuth2ClientException("INVALID_GRANT", false));

        assertThat(provider.renew(1001L, connector).errorCode()).isEqualTo("OAUTH_REFRESH_RETRYABLE");
        assertThat(provider.renew(1001L, connector).errorCode()).isEqualTo("OAUTH_REFRESH_UNAVAILABLE");
    }

    @Test
    void renewalTreatsUnknownSecretStoreFailuresAsRetryable() {
        MailOAuth2Client client = mock(MailOAuth2Client.class);
        ConnectorCredentialSecretStore store = mock(ConnectorCredentialSecretStore.class);
        GmailOAuth2AuthorizationProvider provider = gmail(client, store, name -> env(name));
        ConnectorInfo connector = new ConnectorInfo();
        connector.setConnectorId(9L);
        connector.setAuthConfig("{\"clientIdEnv\":\"GMAIL_OAUTH_CLIENT_ID\","
            + "\"clientSecretEnv\":\"GMAIL_OAUTH_CLIENT_SECRET\"}");
        when(store.findActive("1001", 9L, "gmail-oauth2"))
            .thenThrow(new IllegalStateException("database temporarily unavailable"));

        assertThat(provider.renew(1001L, connector).errorCode()).isEqualTo("OAUTH_REFRESH_RETRYABLE");

        ConnectorCredentialSecret old = ConnectorCredentialSecret.restored("ref", "gmail-oauth2", "1001", 9L,
            "old", "refresh", "Bearer", GMAIL_SCOPE, new Date(), new Date(System.currentTimeMillis() + 60_000L));
        org.mockito.Mockito.reset(store);
        when(store.findActive("1001", 9L, "gmail-oauth2")).thenReturn(Optional.of(old));
        when(client.refresh(any())).thenReturn(new MailOAuth2Client.Token(
            "new", null, "Bearer", null, new Date(), null));
        when(store.replace(any(), any(), any())).thenThrow(new IllegalStateException("encryption unavailable"));

        assertThat(provider.renew(1001L, connector).errorCode()).isEqualTo("OAUTH_REFRESH_RETRYABLE");
    }

    private void assertRefreshTokenReplacement(String returnedRefreshToken, String expectedRefreshToken) {
        MailOAuth2Client client = mock(MailOAuth2Client.class);
        ConnectorCredentialSecretStore store = mock(ConnectorCredentialSecretStore.class);
        GmailOAuth2AuthorizationProvider provider = gmail(client, store, name -> env(name));
        ConnectorCredentialSecret old = ConnectorCredentialSecret.restored("credential-ref", "gmail-oauth2",
            "1001", 9L, "old-access", "old-refresh", "Bearer", GMAIL_SCOPE,
            new Date(1_000L), new Date(System.currentTimeMillis() + 60_000L));
        when(store.findActive("1001", 9L, "gmail-oauth2")).thenReturn(Optional.of(old));
        when(client.refresh(any())).thenReturn(new MailOAuth2Client.Token(
            "new-access", returnedRefreshToken, null, null, new Date(System.currentTimeMillis() + 3_600_000L),
            null));
        when(client.loadProfile(MailOAuth2Client.Provider.GMAIL, "new-access"))
            .thenReturn(new MailOAuth2Client.Profile("user@example.com", "user@example.com", Map.of()));
        ConnectorInfo connector = new ConnectorInfo();
        connector.setConnectorId(9L);
        connector.setAuthConfig("{\"clientIdEnv\":\"GMAIL_OAUTH_CLIENT_ID\","
            + "\"clientSecretEnv\":\"GMAIL_OAUTH_CLIENT_SECRET\"}");

        AuthorizationStatusResult result = provider.renew(1001L, connector);

        assertThat(result.status()).isEqualTo(AuthorizationStatus.CONNECTED);
        assertThat(result.credentialReference()).isEqualTo("credential-ref");
        var replacement = org.mockito.ArgumentCaptor.forClass(ConnectorCredentialSecret.class);
        verify(store).replace(org.mockito.ArgumentMatchers.eq("credential-ref"),
            org.mockito.ArgumentMatchers.eq(old.accessExpiresAt()), replacement.capture());
        assertThat(replacement.getValue().refreshToken()).isEqualTo(expectedRefreshToken);
        assertThat(replacement.getValue().tokenType()).isEqualTo("Bearer");
        assertThat(replacement.getValue().credentialReference()).isEqualTo("credential-ref");
    }

    private GmailOAuth2AuthorizationProvider gmail(MailOAuth2Client client, ConnectorCredentialSecretStore store,
            OAuth2ClientSecretResolver resolver) {
        return new GmailOAuth2AuthorizationProvider(client, store, new ObjectMapper(), resolver);
    }

    private MicrosoftMailOAuth2AuthorizationProvider microsoft(MailOAuth2Client client,
            ConnectorCredentialSecretStore store, OAuth2ClientSecretResolver resolver) {
        return new MicrosoftMailOAuth2AuthorizationProvider(client, store, new ObjectMapper(), resolver);
    }

    private AuthorizationStartContext context(String provider, Map<String, Object> config, String scope) {
        return new AuthorizationStartContext(UUID.randomUUID().toString(), "1001", 9L, "mail", provider,
            "https://frontend.example", config, null);
    }

    private AuthorizationSessionContext session(AuthorizationStartResult start, String provider) {
        String authorizationId;
        try {
            authorizationId = OAuth2State.authorizationId(oauthState(start));
        } catch (RuntimeException e) {
            throw new AssertionError(e);
        }
        return new AuthorizationSessionContext(authorizationId, "1001", 9L, "mail", provider,
            start.providerSessionId(), start.providerState(), start.expiresAt());
    }

    private String oauthState(AuthorizationStartResult start) {
        try {
            return new ObjectMapper().readTree(start.providerState()).path("oauthState").asText();
        } catch (Exception e) {
            throw new AssertionError(e);
        }
    }

    private Map<String, Object> gmailConfig() {
        return Map.of("clientIdEnv", "GMAIL_OAUTH_CLIENT_ID", "clientSecretEnv", "GMAIL_OAUTH_CLIENT_SECRET",
            "redirectUriEnv", "GMAIL_OAUTH_REDIRECT_URI", "scope", GMAIL_SCOPE);
    }

    private Map<String, Object> microsoftConfig() {
        return Map.of("clientIdEnv", "MICROSOFT_OAUTH_CLIENT_ID",
            "clientSecretEnv", "MICROSOFT_OAUTH_CLIENT_SECRET",
            "redirectUriEnv", "MICROSOFT_OAUTH_REDIRECT_URI", "scope", MICROSOFT_SCOPE, "tenant", "common");
    }

    private String env(String name) {
        return switch (name) {
            case "GMAIL_OAUTH_CLIENT_ID", "MICROSOFT_OAUTH_CLIENT_ID" -> "client-id";
            case "GMAIL_OAUTH_CLIENT_SECRET", "MICROSOFT_OAUTH_CLIENT_SECRET" -> "client-secret";
            case "GMAIL_OAUTH_REDIRECT_URI", "MICROSOFT_OAUTH_REDIRECT_URI" -> "https://app.example/callback";
            default -> throw new IllegalStateException("missing " + name);
        };
    }
}
