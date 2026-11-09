package com.iwhalecloud.byai.manager.domain.connector.authorization;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.manager.domain.connector.provider.media.VolcengineDigitalHumanCredentialFormProvider;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorConnectionStateService;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorAuthMapper;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorInfoMapper;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class DigitalHumanConfigProjectionServiceTest {

    private final ConnectorCredentialWorkspaceService workspace = mock(ConnectorCredentialWorkspaceService.class);
    private final ConnectorPrivateFileProjectionWriter writer = mock(ConnectorPrivateFileProjectionWriter.class);
    private final ConnectorConnectionStateService connections = mock(ConnectorConnectionStateService.class);
    private final ConnectorInfoMapper connectors = mock(ConnectorInfoMapper.class);
    private final ConnectorAuthMapper authorizations = mock(ConnectorAuthMapper.class);
    private final Path target = Path.of("/test/user/.connector-auth/.model/video.json");
    private final DigitalHumanConfigProjectionService service = new DigitalHumanConfigProjectionService(
        workspace, writer, connections, connectors, authorizations);

    @BeforeEach
    void setUp() {
        when(workspace.resolveProjectionFile(1001L, DigitalHumanConfigProjectionService.PROJECTION_PATH))
            .thenReturn(target);
    }

    @Test
    void projectsDecryptedCredentialsWithExactlyTheRequestedShape() {
        ConnectorAuth auth = authorization("new-sk");
        assertThat(auth.getAuthCredential()).doesNotContain("new-sk");
        when(connections.findEnabledActiveAuthorization("1001", 2001L)).thenReturn(auth);
        service.sync(1001L, connector());
        ArgumentCaptor<String> payload = ArgumentCaptor.forClass(String.class);
        verify(writer).write(org.mockito.ArgumentMatchers.eq(target), payload.capture());
        assertThat(JSON.parseObject(payload.getValue())).containsExactlyInAnyOrderEntriesOf(Map.of(
            "schemaVersion", 1, "connectorCode", "volcengine-digital-human", "enabled", true,
            "accessKeyId", "test-ak", "secretAccessKey", "new-sk"));
    }

    @Test
    void savingNewCredentialsReplacesTheProjectedSecret() {
        when(connections.findEnabledActiveAuthorization("1001", 2001L))
            .thenReturn(authorization("old-sk"), authorization("new-sk"));
        service.sync(1001L, connector());
        service.sync(1001L, connector());
        ArgumentCaptor<String> payload = ArgumentCaptor.forClass(String.class);
        verify(writer, org.mockito.Mockito.times(2)).write(
            org.mockito.ArgumentMatchers.eq(target), payload.capture());
        assertThat(JSON.parseObject(payload.getAllValues().get(0)).getString("secretAccessKey"))
            .isEqualTo("old-sk");
        assertThat(JSON.parseObject(payload.getAllValues().get(1)).getString("secretAccessKey"))
            .isEqualTo("new-sk");
    }

    @Test
    void disabledMissingOrUnreadyAuthorizationRemovesTheVideoProjection() {
        service.sync(1001L, connector());
        ConnectorAuth auth = authorization("test-sk");
        auth.setCredentialState("REAUTH_REQUIRED");
        when(connections.findEnabledActiveAuthorization("1001", 2001L)).thenReturn(auth);
        service.sync(1001L, connector());
        ConnectorInfo inactive = connector();
        inactive.setStatusCd("00X");
        service.sync(1001L, inactive);
        verify(writer, org.mockito.Mockito.times(3)).delete(target);
    }

    @Test
    void dispatchesSaveAndRevokeEventsWithoutTouchingOtherConnectors() {
        when(connectors.selectById(2001L)).thenReturn(connector());
        when(connections.findEnabledActiveAuthorization("1001", 2001L)).thenReturn(authorization("test-sk"));
        service.handle(new ConnectorCredentialProjectionEvent(1001L, 2001L,
            ConnectorCredentialProjectionEvent.Action.SYNC));
        verify(writer).write(org.mockito.ArgumentMatchers.eq(target), any(String.class));
        service.handle(new ConnectorCredentialProjectionEvent(1001L, 2001L,
            ConnectorCredentialProjectionEvent.Action.DELETE));
        verify(writer).delete(target);
    }

    @Test
    void ignoresImageAndSpeechConnectors() {
        for (String code : java.util.List.of("image-generation-model", "speech-generation-model")) {
            ConnectorInfo other = connector();
            other.setConnectorCode(code);
            other.setProviderCode(code);
            service.sync(1001L, other);
            service.delete(1001L, other);
        }
        verifyNoInteractions(writer, connections);
    }

    @Test
    void refusesMalformedOrMismatchedEncryptedConfigurationWithoutLeakingIt() {
        ConnectorAuth auth = authorization("test-sk");
        auth.setAuthCredential(Sm4Util.encrypt(JSON.toJSONString(Map.of("digitalHumanConfig",
            "{\"schemaVersion\":1,\"connectorCode\":\"image-generation-model\",\"secretAccessKey\":\"test-sk\"}"))));
        when(connections.findEnabledActiveAuthorization("1001", 2001L)).thenReturn(auth);
        assertThatThrownBy(() -> service.sync(1001L, connector()))
            .isInstanceOf(IllegalStateException.class).hasMessageNotContaining("test-sk");
        verifyNoInteractions(writer);
    }

    @Test
    void scheduledReconciliationProjectsEnabledAuthorizations() {
        ConnectorAuth auth = authorization("test-sk");
        auth.setUserId("1001");
        when(connectors.selectList(any())).thenReturn(java.util.List.of(connector()));
        when(authorizations.selectList(any())).thenReturn(java.util.List.of(auth));
        when(connections.findEnabledActiveAuthorization("1001", 2001L)).thenReturn(auth);
        service.reconcileEnabledAuthorizations();
        verify(writer).write(org.mockito.ArgumentMatchers.eq(target), any(String.class));
    }

    private ConnectorInfo connector() {
        ConnectorInfo connector = new ConnectorInfo();
        connector.setConnectorId(2001L);
        connector.setConnectorCode("volcengine-digital-human");
        connector.setProviderCode("volcengine-digital-human");
        connector.setStatusCd("00A");
        return connector;
    }

    private ConnectorAuth authorization(String secret) {
        ConnectorAuth auth = new ConnectorAuth();
        auth.setCredentialState("READY");
        auth.setAuthCredential(Sm4Util.encrypt(JSON.toJSONString(Map.of("digitalHumanConfig",
            JSON.toJSONString(VolcengineDigitalHumanCredentialFormProvider.configuration(Map.of(
                "accessKeyId", "test-ak", "secretAccessKey", secret)))))));
        return auth;
    }
}
