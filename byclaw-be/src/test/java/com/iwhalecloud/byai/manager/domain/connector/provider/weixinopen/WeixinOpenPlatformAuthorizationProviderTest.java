package com.iwhalecloud.byai.manager.domain.connector.provider.weixinopen;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
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
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialSecret;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialSecretStore;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;

class WeixinOpenPlatformAuthorizationProviderTest {
    private final WeixinOpenPlatformConfigResolver configs = mock(WeixinOpenPlatformConfigResolver.class);
    private final WeixinComponentTicketStore tickets = mock(WeixinComponentTicketStore.class);
    private final WeixinOpenPlatformClient client = mock(WeixinOpenPlatformClient.class);
    private final ConnectorCredentialSecretStore secrets = mock(ConnectorCredentialSecretStore.class);
    private final WeixinAuthorizerAuthStore authorizations = mock(WeixinAuthorizerAuthStore.class);
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final WeixinOpenPlatformAuthorizationProvider provider = new WeixinOpenPlatformAuthorizationProvider(
        configs, tickets, client, secrets, authorizations, objectMapper);
    private final WeixinOpenPlatformConfig config = new WeixinOpenPlatformConfig(
        "wx-component", "component-secret", "callback-token", "encoding-key", "https://example/callback");

    @Test
    void createsOfficialAccountOnlyAuthorizationUrl() {
        when(configs.resolve(any())).thenReturn(config);
        when(tickets.findCurrent("wx-component")).thenReturn(Optional.of("ticket"));
        when(client.componentToken("wx-component", "component-secret", "ticket")).thenReturn("component-token");
        when(client.createPreAuthCode("component-token", "wx-component")).thenReturn("preauth");

        var result = provider.start(new AuthorizationStartContext(
            UUID.randomUUID().toString(), "7", 9L, "weixin-open-platform", "weixin-open-platform",
            null, Map.of()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.PENDING);
        assertThat(result.authorizationUrl()).contains("component_appid=wx-component", "pre_auth_code=preauth", "auth_type=1");
        assertThat(result.providerState()).contains("oauthState");
    }

    @Test
    void callbackStoresAuthorizerTokensAndReturnsProfileForCommonAuthBinding() throws Exception {
        when(configs.resolveDefault()).thenReturn(config);
        when(tickets.findCurrent("wx-component")).thenReturn(Optional.of("ticket"));
        when(client.componentToken("wx-component", "component-secret", "ticket")).thenReturn("component-token");
        Date expiry = new Date(System.currentTimeMillis() + 7_200_000);
        when(client.queryAuthorization("component-token", "wx-component", "auth-code"))
            .thenReturn(new WeixinOpenPlatformClient.AuthorizerToken(
                "wx-authorizer", "access", "refresh", "1,2", expiry));
        when(client.getAuthorizerInfo("component-token", "wx-component", "wx-authorizer"))
            .thenReturn(new WeixinOpenPlatformClient.AuthorizerProfile(
                "wx-authorizer", "笙歌数智录", "gh_x", "XXX公司"));
        when(secrets.save(any(ConnectorCredentialSecret.class))).thenReturn("credential-ref");
        String authorizationId = UUID.randomUUID().toString();
        String state = com.iwhalecloud.byai.manager.domain.connector.provider.oauth2.OAuth2State.create(authorizationId);
        String providerState = objectMapper.writeValueAsString(Map.of("oauthState", state));

        var result = provider.handleCallback(new AuthorizationSessionContext(
            authorizationId, "7", 9L, "weixin-open-platform", "weixin-open-platform",
            authorizationId, providerState, new Date(System.currentTimeMillis() + 60_000)),
            new AuthorizationCallback("auth-code", state, null, null));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.CONNECTED);
        assertThat(result.accountId()).isEqualTo("wx-authorizer");
        assertThat(result.accountName()).isEqualTo("笙歌数智录");
        assertThat(result.accountAttributes()).containsEntry("username", "gh_x")
            .containsEntry("principalName", "XXX公司");
        verify(secrets).save(any(ConnectorCredentialSecret.class));
    }

    @Test
    void transientRefreshTimeoutDoesNotReportAuthorizationRevoked() {
        ConnectorInfo connector = new ConnectorInfo();
        connector.setConnectorId(9L);
        when(authorizations.findActive("7", 9L)).thenReturn(Optional.of(
            new WeixinAuthorizerAuthStore.Binding(
                "wx-authorizer", "笙歌数智录", "gh_x", "XXX公司", "credential-ref")));
        when(secrets.findActive("7", 9L, "weixin-open-platform")).thenReturn(Optional.of(
            ConnectorCredentialSecret.restored("credential-ref", "weixin-open-platform", "7", 9L,
                "access", "refresh", "Bearer", "1", new Date(0), null)));
        when(configs.resolveDefault()).thenReturn(config);
        when(tickets.findCurrent("wx-component")).thenReturn(Optional.of("ticket"));
        when(client.componentToken("wx-component", "component-secret", "ticket"))
            .thenThrow(new WeixinOpenPlatformClientException("timeout", true));

        var result = provider.verify(7L, connector);

        assertThat(result.errorCode()).isEqualTo("CONNECTOR_VERIFICATION_TIMEOUT");
        assertThat(result.errorCode()).isNotEqualTo("WEIXIN_AUTHORIZATION_REVOKED");
    }
}
