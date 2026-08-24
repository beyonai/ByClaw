package com.iwhalecloud.byai.manager.domain.connector.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.manager.application.service.user.UserPrivateParamApplicationService;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatusResult;
import com.iwhalecloud.byai.manager.domain.connector.manifest.InvalidConnectorManifestException;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorAuthMapper;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorInfoMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.util.Date;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class ConnectorConnectionStateServiceTest {

    private static final String USER_ID = "1001";
    private static final Long CONNECTOR_ID = 15L;

    private ConnectorAuthMapper connectorAuthMapper;
    private ConnectorInfoMapper connectorInfoMapper;
    private SequenceService sequenceService;
    private ConnectorManifestService manifestService;
    private UserService userService;
    private UserPrivateParamApplicationService privateParamService;
    private ConnectorConnectionStateService service;

    @BeforeEach
    void setUp() {
        connectorAuthMapper = mock(ConnectorAuthMapper.class);
        connectorInfoMapper = mock(ConnectorInfoMapper.class);
        sequenceService = mock(SequenceService.class);
        manifestService = mock(ConnectorManifestService.class);
        userService = mock(UserService.class);
        privateParamService = mock(UserPrivateParamApplicationService.class);
        service = new ConnectorConnectionStateService(
            connectorAuthMapper,
            connectorInfoMapper,
            sequenceService,
            manifestService,
            userService,
            privateParamService
        );
        when(connectorAuthMapper.insertActiveIgnoreConflict(any())).thenReturn(1);
        when(connectorAuthMapper.updateById(any())).thenReturn(1);
        Users user = new Users();
        user.setUserId(1001L);
        user.setUserCode("tester");
        when(userService.findById(1001L)).thenReturn(user);
    }

    @Test
    void saveEnabledAuthorizationWritesBindingProjectionAndSchedulesCacheRefresh() {
        ConnectorInfo connector = connector();
        when(connectorAuthMapper.selectOne(any())).thenReturn(null);
        when(sequenceService.nextVal()).thenReturn(8001L);
        when(manifestService.upsertAndEnable(1001L, connector)).thenReturn(true);
        AuthorizationStatusResult result = new AuthorizationStatusResult(
            AuthorizationStatus.CONNECTED,
            "ou_1001",
            "Tester",
            new Date(System.currentTimeMillis() + 60_000L),
            "workspace-ref",
            null,
            null
        );

        ConnectorAuth binding = service.saveEnabledAuthorization(USER_ID, connector, result, "authorization-1");

        ArgumentCaptor<ConnectorAuth> captor = ArgumentCaptor.forClass(ConnectorAuth.class);
        verify(connectorAuthMapper).insertActiveIgnoreConflict(captor.capture());
        assertThat(binding).isSameAs(captor.getValue());
        assertThat(binding.getEnableFlag()).isEqualTo("Y");
        assertThat(binding.getUserId()).isEqualTo(USER_ID);
        assertThat(Sm4Util.decrypt(binding.getAuthCredential()))
            .contains("authorization-1", "workspace-ref", "ou_1001");
        verify(manifestService).upsertAndEnable(1001L, connector);
        verify(privateParamService).refreshPrivateParamCacheAfterCommit(1001L, "tester");
    }

    @Test
    void saveNoneAuthorizationWritesNonNullLifecycleDefaults() {
        ConnectorInfo connector = connector();
        connector.setAuthMode("NONE");
        connector.setProviderCode(null);
        when(connectorAuthMapper.selectOne(any())).thenReturn(null);
        when(sequenceService.nextVal()).thenReturn(8002L);
        when(manifestService.upsertAndEnable(1001L, connector)).thenReturn(false);

        ConnectorAuth binding = service.saveEnabledAuthorization(USER_ID, connector, null, null);

        assertThat(binding.getCredentialState()).isEqualTo("UNKNOWN");
        assertThat(binding.getRenewalMode()).isEqualTo("NONE");
        assertThat(binding.getAuthCredential()).isNull();
    }

    @Test
    void credentialAuthorizationRefreshesCacheEvenWhenCredentialRowsAreUnchanged() {
        ConnectorInfo connector = connector();
        connector.setConnectorCode("ima-openapi");
        when(connectorAuthMapper.selectOne(any())).thenReturn(null);
        when(sequenceService.nextVal()).thenReturn(8010L);
        when(manifestService.upsertAndEnable(eq(1001L), eq(connector), any())).thenReturn(false);

        service.saveEnabledCredentialAuthorization(USER_ID, connector, new AuthorizationStatusResult(
            AuthorizationStatus.CONNECTED, null, "IMA", null, null, null, null), "authorization-id",
            java.util.Map.of("IMA_OPENAPI_CLIENTID", "client", "IMA_OPENAPI_APIKEY", "key"));

        verify(privateParamService).refreshPrivateParamCacheAfterCommit(1001L, "tester");
    }

    @Test
    void credentialAuthorizationPersistsSecretsBeforeBindingAndNeverStoresThemInAuthCredential() {
        ConnectorInfo connector = connector();
        connector.setConnectorCode("ima-openapi");
        when(connectorAuthMapper.selectOne(any())).thenReturn(null);
        when(sequenceService.nextVal()).thenReturn(8011L);
        when(manifestService.upsertAndEnable(eq(1001L), eq(connector), any())).thenReturn(true);
        AuthorizationStatusResult result = new AuthorizationStatusResult(
            AuthorizationStatus.CONNECTED, null, "IMA", null, null, null, null);

        ConnectorAuth saved = service.saveEnabledCredentialAuthorization(USER_ID, connector, result, "auth-id",
            java.util.Map.of("IMA_OPENAPI_CLIENTID", "client-secret", "IMA_OPENAPI_APIKEY", "api-secret"));

        org.mockito.InOrder order = org.mockito.Mockito.inOrder(manifestService, connectorAuthMapper);
        order.verify(manifestService).upsertAndEnable(eq(1001L), eq(connector), any());
        order.verify(connectorAuthMapper).insertActiveIgnoreConflict(any());
        String credential = Sm4Util.decrypt(saved.getAuthCredential());
        assertThat(credential).doesNotContain("client-secret", "api-secret", "IMA_OPENAPI_CLIENTID", "IMA_OPENAPI_APIKEY");
    }

    @Test
    void credentialPersistenceFailureDoesNotWriteBindingOrRefreshCacheAndIsTransactional() throws Exception {
        ConnectorInfo connector = connector();
        connector.setConnectorCode("ima-openapi");
        when(manifestService.upsertAndEnable(eq(1001L), eq(connector), any()))
            .thenThrow(new IllegalStateException("persist failed"));

        assertThatThrownBy(() -> service.saveEnabledCredentialAuthorization(USER_ID, connector, null, "id", Map.of()))
            .isInstanceOf(IllegalStateException.class);
        verify(connectorAuthMapper, never()).insertActiveIgnoreConflict(any());
        verify(connectorAuthMapper, never()).updateById(any());
        verify(privateParamService, never()).refreshPrivateParamCacheAfterCommit(any(), any());
        org.springframework.transaction.annotation.Transactional tx = ConnectorConnectionStateService.class
            .getMethod("saveEnabledCredentialAuthorization", String.class, ConnectorInfo.class,
                AuthorizationStatusResult.class, String.class, Map.class)
            .getAnnotation(org.springframework.transaction.annotation.Transactional.class);
        assertThat(tx.rollbackFor()).containsExactly(Exception.class);
    }

    @Test
    void saveEnabledAuthorizationUpdatesConcurrentWinnerWhenInsertIsIgnored() {
        ConnectorInfo connector = connector();
        ConnectorAuth winner = activeAuth();
        winner.setEnableFlag("N");
        when(connectorAuthMapper.selectOne(any())).thenReturn(null, winner);
        when(connectorAuthMapper.insertActiveIgnoreConflict(any())).thenReturn(0);
        when(manifestService.upsertAndEnable(1001L, connector)).thenReturn(false);

        ConnectorAuth binding = service.saveEnabledAuthorization(
            USER_ID,
            connector,
            new AuthorizationStatusResult(
                AuthorizationStatus.CONNECTED,
                "ou_1001",
                "Tester",
                null,
                "workspace-ref",
                null,
                null
            ),
            "authorization-2"
        );

        assertThat(binding).isSameAs(winner);
        assertThat(winner.getEnableFlag()).isEqualTo("Y");
        verify(connectorAuthMapper).updateById(winner);
    }

    @Test
    void updateEnableFlagUsesLatestTemplateAndRetainsDisabledProjection() {
        ConnectorInfo connector = connector();
        ConnectorAuth auth = activeAuth();
        when(connectorAuthMapper.selectOne(any())).thenReturn(auth);
        when(connectorInfoMapper.selectById(CONNECTOR_ID)).thenReturn(connector);
        when(manifestService.upsertAndEnable(1001L, connector)).thenReturn(true);

        service.updateEnableFlag(USER_ID, CONNECTOR_ID, true);

        assertThat(auth.getEnableFlag()).isEqualTo("Y");
        verify(manifestService).upsertAndEnable(1001L, connector);
        verify(privateParamService).refreshPrivateParamCacheAfterCommit(1001L, "tester");

        when(manifestService.disable(1001L, connector)).thenReturn(true);
        service.updateEnableFlag(USER_ID, CONNECTOR_ID, false);

        assertThat(auth.getEnableFlag()).isEqualTo("N");
        verify(manifestService).disable(1001L, connector);
    }

    @Test
    void managedEnvironmentTogglesRefreshPrivateParameterCacheAfterEveryStateChange() {
        ConnectorInfo connector = connector();
        connector.setConnectorCode("ima-openapi");
        ConnectorAuth auth = activeAuth();
        when(connectorAuthMapper.selectOne(any())).thenReturn(auth);
        when(connectorInfoMapper.selectById(CONNECTOR_ID)).thenReturn(connector);
        when(manifestService.upsertAndEnable(1001L, connector)).thenReturn(true);
        when(manifestService.disable(1001L, connector)).thenReturn(true);
        when(manifestService.readManagedCredentials(eq(1001L), eq(connector), any())).thenReturn(
            Map.of("IMA_OPENAPI_CLIENTID", "client", "IMA_OPENAPI_APIKEY", "key"));

        service.updateEnableFlag(USER_ID, CONNECTOR_ID, true);
        service.updateEnableFlag(USER_ID, CONNECTOR_ID, false);

        verify(privateParamService, times(2)).refreshPrivateParamCacheAfterCommit(1001L, "tester");
    }

    @Test
    void updateEnableFlagUsesEnableFlagEvenWhenExpirationFieldIsPast() {
        ConnectorInfo connector = connector();
        ConnectorAuth auth = activeAuth();
        auth.setExpireTime(new Date(System.currentTimeMillis() - 1_000L));
        when(connectorAuthMapper.selectOne(any())).thenReturn(auth);
        when(connectorInfoMapper.selectById(CONNECTOR_ID)).thenReturn(connector);
        when(manifestService.upsertAndEnable(1001L, connector)).thenReturn(false);

        service.updateEnableFlag(USER_ID, CONNECTOR_ID, true);

        verify(manifestService).upsertAndEnable(1001L, connector);
        verify(connectorAuthMapper).updateById(auth);
        assertThat(auth.getEnableFlag()).isEqualTo("Y");
    }

    @Test
    void updateEnableFlagRejectsMissingOrInvalidLatestManifestWithoutChangingBinding() {
        ConnectorInfo connector = connector();
        ConnectorAuth auth = activeAuth();
        auth.setEnableFlag("N");
        when(connectorAuthMapper.selectOne(any())).thenReturn(auth);
        when(connectorInfoMapper.selectById(CONNECTOR_ID)).thenReturn(connector);
        when(manifestService.upsertAndEnable(1001L, connector))
            .thenThrow(new InvalidConnectorManifestException("runtime_manifest is required"));

        assertThatThrownBy(() -> service.updateEnableFlag(USER_ID, CONNECTOR_ID, true))
            .isInstanceOf(InvalidConnectorManifestException.class);
        assertThat(auth.getEnableFlag()).isEqualTo("N");
    }

    @Test
    void revokeAuthorizationSoftInvalidatesBindingAndDisablesManifest() {
        ConnectorInfo connector = connector();
        ConnectorAuth auth = activeAuth();
        auth.setEnableFlag("Y");
        when(connectorAuthMapper.selectOne(any())).thenReturn(auth);
        when(connectorInfoMapper.selectById(CONNECTOR_ID)).thenReturn(connector);
        when(manifestService.disable(1001L, connector)).thenReturn(true);

        service.revokeAuthorization(USER_ID, CONNECTOR_ID);

        assertThat(auth.getStatusCd()).isEqualTo("00X");
        assertThat(auth.getEnableFlag()).isEqualTo("N");
        verify(manifestService).disable(1001L, connector);
        verify(connectorAuthMapper).updateById(auth);
        verify(privateParamService).refreshPrivateParamCacheAfterCommit(1001L, "tester");
    }

    @Test
    void revokeAuthorizationPhysicallyDeletesManifestManagedCredentials() {
        ConnectorInfo connector = connector();
        connector.setConnectorCode("ima-openapi");
        ConnectorAuth auth = activeAuth();
        when(connectorAuthMapper.selectOne(any())).thenReturn(auth);
        when(connectorInfoMapper.selectById(CONNECTOR_ID)).thenReturn(connector);
        when(manifestService.managedEnvironmentKeys(connector)).thenReturn(
            java.util.List.of("IMA_OPENAPI_CLIENTID", "IMA_OPENAPI_APIKEY"));
        when(manifestService.removeManagedCredentials(1001L, connector)).thenReturn(true);

        service.revokeAuthorization(USER_ID, CONNECTOR_ID);

        verify(manifestService).removeManagedCredentials(1001L, connector);
        verify(manifestService, never()).disable(1001L, connector);
        verify(privateParamService).refreshPrivateParamCacheAfterCommit(1001L, "tester");
    }

    @Test
    void revokeAuthorizationDeletesAkSkCredentialsEvenWhenCurrentManifestHasNoManagedKeys() {
        ConnectorInfo connector = connector();
        connector.setConnectorCode("ima-openapi");
        connector.setAuthMode("AK_SK");
        ConnectorAuth auth = activeAuth();
        when(connectorAuthMapper.selectOne(any())).thenReturn(auth);
        when(connectorInfoMapper.selectById(CONNECTOR_ID)).thenReturn(connector);
        when(manifestService.removeManagedCredentials(1001L, connector)).thenReturn(true);

        service.revokeAuthorization(USER_ID, CONNECTOR_ID);

        verify(manifestService).removeManagedCredentials(1001L, connector);
        verify(manifestService, never()).disable(1001L, connector);
    }

    @Test
    void revokeAuthorizationDeletesAkSkCredentialsWhenCurrentManifestIsInvalid() {
        ConnectorInfo connector = connector();
        connector.setConnectorCode("ima-openapi");
        connector.setAuthMode("AK_SK");
        when(connectorAuthMapper.selectOne(any())).thenReturn(null);
        when(connectorInfoMapper.selectById(CONNECTOR_ID)).thenReturn(connector);
        when(manifestService.removeManagedCredentials(1001L, connector)).thenReturn(true);
        when(manifestService.managedEnvironmentKeys(connector))
            .thenThrow(new InvalidConnectorManifestException("runtime_manifest is invalid"));

        service.revokeAuthorization(USER_ID, CONNECTOR_ID);

        verify(manifestService).removeManagedCredentials(1001L, connector);
        verify(manifestService, never()).managedEnvironmentKeys(connector);
    }

    @Test
    void revokeAuthorizationDeletesAkSkCredentialsAfterConnectorIsDisabled() {
        ConnectorInfo connector = connector();
        connector.setConnectorCode("ima-openapi");
        connector.setAuthMode("AK_SK");
        connector.setStatusCd("00X");
        when(connectorAuthMapper.selectOne(any())).thenReturn(null);
        when(connectorInfoMapper.selectById(CONNECTOR_ID)).thenReturn(connector);
        when(manifestService.removeManagedCredentials(1001L, connector)).thenReturn(true);

        service.revokeAuthorization(USER_ID, CONNECTOR_ID);

        verify(manifestService).removeManagedCredentials(1001L, connector);
    }

    @Test
    void revokeAuthorizationDeletesOrphanedAkSkCredentialsWithoutAnActiveBinding() {
        ConnectorInfo connector = connector();
        connector.setConnectorCode("ima-openapi");
        connector.setAuthMode("AK_SK");
        when(connectorAuthMapper.selectOne(any())).thenReturn(null);
        when(connectorInfoMapper.selectById(CONNECTOR_ID)).thenReturn(connector);
        when(manifestService.removeManagedCredentials(1001L, connector)).thenReturn(true);

        service.revokeAuthorization(USER_ID, CONNECTOR_ID);

        verify(manifestService).removeManagedCredentials(1001L, connector);
        verify(connectorAuthMapper, never()).updateById(any());
        verify(privateParamService).refreshPrivateParamCacheAfterCommit(1001L, "tester");
    }

    @Test
    void managedCredentialRevocationSkipsCacheRefreshWhenDeleteReportsNoChange() {
        ConnectorInfo connector = connector();
        connector.setConnectorCode("ima-openapi");
        ConnectorAuth auth = activeAuth();
        when(connectorAuthMapper.selectOne(any())).thenReturn(auth);
        when(connectorInfoMapper.selectById(CONNECTOR_ID)).thenReturn(connector);
        when(manifestService.managedEnvironmentKeys(connector)).thenReturn(
            java.util.List.of("IMA_OPENAPI_CLIENTID", "IMA_OPENAPI_APIKEY"));
        when(manifestService.removeManagedCredentials(1001L, connector)).thenReturn(false);

        service.revokeAuthorization(USER_ID, CONNECTOR_ID);

        verify(privateParamService, never()).refreshPrivateParamCacheAfterCommit(any(), any());
        verify(connectorAuthMapper).updateById(auth);
    }

    @Test
    void managedCredentialRevocationDeletesSecretsBeforeUnlinkingBinding() {
        ConnectorInfo connector = connector();
        connector.setConnectorCode("ima-openapi");
        ConnectorAuth auth = activeAuth();
        when(connectorAuthMapper.selectOne(any())).thenReturn(auth);
        when(connectorInfoMapper.selectById(CONNECTOR_ID)).thenReturn(connector);
        when(manifestService.managedEnvironmentKeys(connector)).thenReturn(
            java.util.List.of("IMA_OPENAPI_CLIENTID", "IMA_OPENAPI_APIKEY"));
        when(manifestService.removeManagedCredentials(1001L, connector)).thenReturn(true);

        service.revokeAuthorization(USER_ID, CONNECTOR_ID);

        org.mockito.InOrder order = org.mockito.Mockito.inOrder(manifestService, connectorAuthMapper);
        order.verify(manifestService).removeManagedCredentials(1001L, connector);
        order.verify(connectorAuthMapper).updateById(auth);
    }

    @Test
    void credentialRemovalFailureDoesNotUnlinkOrRefreshAndIsTransactional() throws Exception {
        ConnectorInfo connector = connector();
        connector.setConnectorCode("ima-openapi");
        ConnectorAuth auth = activeAuth();
        when(connectorAuthMapper.selectOne(any())).thenReturn(auth);
        when(connectorInfoMapper.selectById(CONNECTOR_ID)).thenReturn(connector);
        when(manifestService.managedEnvironmentKeys(connector)).thenReturn(
            java.util.List.of("IMA_OPENAPI_CLIENTID", "IMA_OPENAPI_APIKEY"));
        when(manifestService.removeManagedCredentials(1001L, connector))
            .thenThrow(new IllegalStateException("delete failed"));

        assertThatThrownBy(() -> service.revokeAuthorization(USER_ID, CONNECTOR_ID))
            .isInstanceOf(IllegalStateException.class);
        verify(connectorAuthMapper, never()).updateById(any());
        verify(privateParamService, never()).refreshPrivateParamCacheAfterCommit(any(), any());
        org.springframework.transaction.annotation.Transactional tx = ConnectorConnectionStateService.class
            .getMethod("revokeAuthorization", String.class, Long.class)
            .getAnnotation(org.springframework.transaction.annotation.Transactional.class);
        assertThat(tx.rollbackFor()).containsExactly(Exception.class);
    }

    private ConnectorInfo connector() {
        ConnectorInfo connector = new ConnectorInfo();
        connector.setConnectorId(CONNECTOR_ID);
        connector.setConnectorCode("dingtalk");
        connector.setConnectorName("钉钉");
        connector.setAuthMode("DEVICE_FLOW");
        connector.setProviderCode("dws-dingtalk");
        connector.setRuntimeManifest("{}");
        connector.setStatusCd("00A");
        return connector;
    }

    private ConnectorAuth activeAuth() {
        ConnectorAuth auth = new ConnectorAuth();
        auth.setAuthId(7001L);
        auth.setUserId(USER_ID);
        auth.setConnectorId(CONNECTOR_ID);
        auth.setEnableFlag("N");
        auth.setStatusCd("00A");
        return auth;
    }
}
