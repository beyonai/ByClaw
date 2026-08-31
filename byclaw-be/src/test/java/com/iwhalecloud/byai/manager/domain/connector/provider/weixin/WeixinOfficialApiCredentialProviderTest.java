package com.iwhalecloud.byai.manager.domain.connector.provider.weixin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialFormVerification;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorManifestService;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;

class WeixinOfficialApiCredentialProviderTest {

    private WeixinOfficialApiClient client;
    private ConnectorManifestService manifestService;
    private WeixinOfficialApiCredentialProvider provider;

    @BeforeEach
    void setUp() {
        client = mock(WeixinOfficialApiClient.class);
        manifestService = mock(ConnectorManifestService.class);
        provider = new WeixinOfficialApiCredentialProvider(client, manifestService);
    }

    @Test
    void mapsVerifiedFormValuesToManagedEnvironment() {
        when(client.verify("wx-app", "wx-secret")).thenReturn(WeixinOfficialApiClient.Status.VALID);

        CredentialFormVerification result = provider.verify("1001", connector(), credentials());

        assertThat(result.status().status()).isEqualTo(AuthorizationStatus.CONNECTED);
        assertThat(result.status().accountName()).isEqualTo("微信公众号 API");
        assertThat(result.runtimeEnvironment()).containsExactlyInAnyOrderEntriesOf(Map.of(
            "WECHAT_APPID", "wx-app",
            "WECHAT_APPSECRET", "wx-secret"
        ));
    }

    @Test
    void mapsProbeFailuresToSafeConnectorCodesAndDropsTheEnvironment() {
        Map<WeixinOfficialApiClient.Status, String> expected = Map.of(
            WeixinOfficialApiClient.Status.INVALID_CREDENTIALS, "CONNECTOR_CREDENTIAL_INVALID",
            WeixinOfficialApiClient.Status.IP_NOT_ALLOWLISTED, "WEIXIN_IP_NOT_ALLOWLISTED",
            WeixinOfficialApiClient.Status.TIMEOUT, "CONNECTOR_VERIFICATION_TIMEOUT",
            WeixinOfficialApiClient.Status.FAILED, "CONNECTOR_VERIFICATION_FAILED",
            WeixinOfficialApiClient.Status.PROTOCOL_ERROR, "PROVIDER_PROTOCOL_ERROR"
        );
        for (Map.Entry<WeixinOfficialApiClient.Status, String> entry : expected.entrySet()) {
            when(client.verify("wx-app", "wx-secret")).thenReturn(entry.getKey());

            CredentialFormVerification result = provider.verify("1001", connector(), credentials());

            assertThat(result.status().errorCode()).isEqualTo(entry.getValue());
            assertThat(result.status().errorMessage()).doesNotContain("wx-app", "wx-secret");
            assertThat(result.runtimeEnvironment()).isEmpty();
        }
    }

    @Test
    void rejectsIncompleteExtraOversizedBlankAndControlCharacterValuesBeforeTheProbe() {
        for (Map<String, String> invalid : java.util.List.of(
                Map.of("appId", "wx-app"),
                Map.of("appId", "wx-app", "appSecret", "wx-secret", "extra", "value"),
                Map.of("appId", " ", "appSecret", "wx-secret"),
                Map.of("appId", "x".repeat(257), "appSecret", "wx-secret"),
                Map.of("appId", "wx-app", "appSecret", "x".repeat(2049)),
                Map.of("appId", "wx\napp", "appSecret", "wx-secret"),
                Map.of("appId", "wx-app", "appSecret", "wx\u0000secret"))) {
            assertThatThrownBy(() -> provider.verify("1001", connector(), invalid))
                .isInstanceOf(IllegalArgumentException.class);
        }
        verifyNoInteractions(client);
    }

    @Test
    void verifiesOnlyTheExactStoredManagedCredentialPair() {
        ConnectorInfo connector = connector();
        when(manifestService.readManagedCredentialsForVerification(
            1001L, connector, Set.of("WECHAT_APPID", "WECHAT_APPSECRET")))
            .thenReturn(Map.of("WECHAT_APPID", "wx-app", "WECHAT_APPSECRET", "wx-secret"));
        when(client.verify("wx-app", "wx-secret")).thenReturn(WeixinOfficialApiClient.Status.VALID);

        assertThat(provider.verify(1001L, connector).status()).isEqualTo(AuthorizationStatus.CONNECTED);

        verify(manifestService).readManagedCredentialsForVerification(
            1001L, connector, Set.of("WECHAT_APPID", "WECHAT_APPSECRET"));
        verify(client).verify("wx-app", "wx-secret");
    }

    private ConnectorInfo connector() {
        ConnectorInfo connector = new ConnectorInfo();
        connector.setConnectorCode("weixin-official-api");
        connector.setProviderCode("weixin-official-api");
        return connector;
    }

    private Map<String, String> credentials() {
        return Map.of("appId", "wx-app", "appSecret", "wx-secret");
    }
}
