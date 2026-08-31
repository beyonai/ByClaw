package com.iwhalecloud.byai.manager.domain.connector.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.Map;
import java.util.Optional;

import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationProviderRegistry;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationQrCodeEncoder;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatusResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialFormProvider;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialFormProviderRegistry;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialFormVerification;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialRenewalMode;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialState;
import com.iwhalecloud.byai.manager.domain.connector.authorization.RedisAuthorizationSessionRepository;
import com.iwhalecloud.byai.manager.dto.connector.StartConnectorAuthorizationRequest;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorAuthMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

class WeixinCredentialAuthorizationLifecycleTest {

    @Test
    void successfulWeixinVerificationPersistsOnlyManagedEnvironment() {
        Fixture fixture = fixture();
        when(fixture.formProvider.verify(eq("1001"), eq(fixture.connector), any())).thenReturn(
            new CredentialFormVerification(
                AuthorizationStatusResult.connected(null, "微信公众号 API", CredentialState.READY,
                    CredentialRenewalMode.NONE, null, null, null, null),
                Map.of("WECHAT_APPID", "wx-app", "WECHAT_APPSECRET", "wx-secret")));

        var result = fixture.service.start(request(), "1001");

        assertThat(result.getStatus()).isEqualTo("connected");
        verify(fixture.stateService).saveEnabledCredentialAuthorization(
            eq("1001"), eq(fixture.connector), any(), any(),
            eq(Map.of("WECHAT_APPID", "wx-app", "WECHAT_APPSECRET", "wx-secret")));
        verify(fixture.sessions, never()).create(any());
    }

    @Test
    void ipAllowlistFailureDoesNotPersistCredentials() {
        Fixture fixture = fixture();
        when(fixture.formProvider.verify(any(), any(), any())).thenReturn(new CredentialFormVerification(
            new AuthorizationStatusResult(AuthorizationStatus.FAILED, null, null, null, null,
                "WEIXIN_IP_NOT_ALLOWLISTED", "safe"), Map.of()));

        var result = fixture.service.start(request(), "1001");

        assertThat(result.getStatus()).isEqualTo("failed");
        assertThat(result.getErrorCode()).isEqualTo("WEIXIN_IP_NOT_ALLOWLISTED");
        verifyNoInteractions(fixture.stateService);
        verify(fixture.sessions).releaseStartLock("1001", 12L, "lock");
    }

    private Fixture fixture() {
        ConnectorInfoService connectorInfoService = mock(ConnectorInfoService.class);
        RedisAuthorizationSessionRepository sessions = mock(RedisAuthorizationSessionRepository.class);
        ConnectorConnectionStateService stateService = mock(ConnectorConnectionStateService.class);
        ConnectorCredentialFormProvider formProvider = mock(ConnectorCredentialFormProvider.class);
        ConnectorCredentialFormProviderRegistry formProviders = mock(ConnectorCredentialFormProviderRegistry.class);
        ConnectorInfo connector = connector();
        when(connectorInfoService.findById(12L)).thenReturn(connector);
        when(formProviders.get("weixin-official-api")).thenReturn(formProvider);
        when(sessions.tryAcquireStartLock(eq("1001"), eq(12L), any())).thenReturn(Optional.of("lock"));
        ConnectorAuthorizationService service = new ConnectorAuthorizationService(
            connectorInfoService,
            mock(AuthorizationProviderRegistry.class),
            sessions,
            mock(ConnectorAuthMapper.class),
            mock(SequenceService.class),
            stateService,
            new AuthorizationQrCodeEncoder(),
            null,
            formProviders
        );
        return new Fixture(service, sessions, stateService, formProvider, connector);
    }

    private StartConnectorAuthorizationRequest request() {
        StartConnectorAuthorizationRequest request = new StartConnectorAuthorizationRequest();
        request.setConnectorId(12L);
        request.setCredentials(Map.of("appId", "wx-app", "appSecret", "wx-secret"));
        return request;
    }

    private ConnectorInfo connector() {
        ConnectorInfo connector = new ConnectorInfo();
        connector.setConnectorId(12L);
        connector.setConnectorCode("weixin-official-api");
        connector.setProviderCode("weixin-official-api");
        connector.setAuthMode("AK_SK");
        connector.setStatusCd("00A");
        return connector;
    }

    private record Fixture(
        ConnectorAuthorizationService service,
        RedisAuthorizationSessionRepository sessions,
        ConnectorConnectionStateService stateService,
        ConnectorCredentialFormProvider formProvider,
        ConnectorInfo connector
    ) {
    }
}
