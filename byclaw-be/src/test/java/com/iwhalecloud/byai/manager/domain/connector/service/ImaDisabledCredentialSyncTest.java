package com.iwhalecloud.byai.manager.domain.connector.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.manager.application.service.user.UserPrivateParamApplicationService;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCliRunner;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialVerifierRegistry;
import com.iwhalecloud.byai.manager.domain.connector.authorization.RedisAuthorizationSessionRepository;
import com.iwhalecloud.byai.manager.domain.connector.manifest.ConnectorManifestCanonicalizer;
import com.iwhalecloud.byai.manager.domain.connector.provider.ima.ImaOpenApiCliCredentialProvider;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.entity.users.UserPrivateParam;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorAuthMapper;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorInfoMapper;
import com.iwhalecloud.byai.manager.mapper.users.UserPrivateParamMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;

class ImaDisabledCredentialSyncTest {

    private UserPrivateParam client;
    private UserPrivateParam apiKey;
    private UserPrivateParamMapper paramMapper;
    private ConnectorAuthMapper authMapper;
    private UserPrivateParamApplicationService privateParamService;
    private ConnectorSkillAuthorizationSyncService syncService;
    private ConnectorCliRunner cliRunner;

    @BeforeEach
    void setUp() {
        client = credential("IMA_OPENAPI_CLIENTID", "client-id");
        apiKey = credential("IMA_OPENAPI_APIKEY", "api-key");
        paramMapper = mock(UserPrivateParamMapper.class);
        when(paramMapper.selectList(any())).thenReturn(List.of(client, apiKey));
        when(paramMapper.updateById(any())).thenReturn(1);
        SequenceService sequenceService = mock(SequenceService.class);
        ConnectorManifestService manifestService = new ConnectorManifestService(paramMapper, sequenceService,
            new ConnectorManifestCanonicalizer(new ObjectMapper()));
        cliRunner = mock(ConnectorCliRunner.class);
        ImaOpenApiCliCredentialProvider verifier = new ImaOpenApiCliCredentialProvider(cliRunner, manifestService);
        ConnectorCredentialVerifierRegistry registry = mock(ConnectorCredentialVerifierRegistry.class);
        when(registry.get("ima-openapi")).thenReturn(verifier);
        ConnectorInfo connector = connector();
        ConnectorInfoService infoService = mock(ConnectorInfoService.class);
        when(infoService.findByCode("ima-openapi")).thenReturn(connector);
        authMapper = mock(ConnectorAuthMapper.class);
        when(authMapper.insertActiveIgnoreConflict(any())).thenReturn(1);
        when(sequenceService.nextVal()).thenReturn(91L);
        UserService userService = mock(UserService.class);
        Users user = new Users();
        user.setUserId(1001L);
        user.setUserCode("ima-user");
        when(userService.findById(1001L)).thenReturn(user);
        privateParamService = mock(UserPrivateParamApplicationService.class);
        ConnectorConnectionStateService stateService = new ConnectorConnectionStateService(
            authMapper, mock(ConnectorInfoMapper.class), sequenceService, manifestService, userService, privateParamService);
        ConnectorSkillAuthorizationSyncProperties properties = new ConnectorSkillAuthorizationSyncProperties(2, 0);
        RedisAuthorizationSessionRepository sessionRepository = mock(RedisAuthorizationSessionRepository.class);
        when(sessionRepository.tryAcquireStartLock(any(), any(), any())).thenReturn(java.util.Optional.of("sync-lock"));
        syncService = new ConnectorSkillAuthorizationSyncService(infoService, registry, stateService, properties,
            new ConnectorSkillAuthorizationSyncMetrics(new SimpleMeterRegistry()),
            new ConnectorCredentialVerificationGuard(properties), sessionRepository);
    }

    @Test
    void successfulProbeRestoresDisabledPairToNormalAndRefreshesCache() {
        when(cliRunner.run(any(), any(), any(), any(Duration.class))).thenReturn(new ConnectorCliRunner.CliResult(0,
            "{\"status\":\"ok\",\"checks\":{\"client_id_present\":true,\"api_key_present\":true,\"token_fetch\":true}}"));

        assertThat(syncService.sync("ima", "1001").getConnected()).isTrue();

        assertThat(client.getStatus()).isEqualTo("NORMAL");
        assertThat(apiKey.getStatus()).isEqualTo("NORMAL");
        verify(paramMapper, org.mockito.Mockito.times(2)).updateById(any());
        verify(privateParamService).refreshPrivateParamCacheAfterCommit(1001L, "ima-user");
    }

    @Test
    void failedProbeLeavesDisabledPairUntouchedAndNeverRefreshesCache() {
        when(cliRunner.run(any(), any(), any(), any(Duration.class)))
            .thenReturn(new ConnectorCliRunner.CliResult(7, "secret output"));

        assertThatThrownBy(() -> syncService.sync("ima", "1001"))
            .isInstanceOf(ConnectorSkillAuthorizationSyncException.class);

        assertThat(client.getStatus()).isEqualTo("DISABLED");
        assertThat(apiKey.getStatus()).isEqualTo("DISABLED");
        verify(paramMapper, never()).updateById(any());
        verifyNoInteractions(authMapper, privateParamService);
    }

    private UserPrivateParam credential(String key, String value) {
        UserPrivateParam param = new UserPrivateParam();
        param.setParamId((long) Math.abs(key.hashCode()));
        param.setUserId(1001L);
        param.setParamKey(key);
        param.setParamValueCipher(Sm4Util.encrypt(value));
        param.setParamSource("CONNECTOR");
        param.setSourceRef("ima-openapi");
        param.setStatus("DISABLED");
        param.setDeleteFlag("0");
        return param;
    }

    private ConnectorInfo connector() {
        ConnectorInfo connector = new ConnectorInfo();
        connector.setConnectorId(16L);
        connector.setConnectorCode("ima-openapi");
        connector.setConnectorName("IMA");
        connector.setProviderCode("ima-openapi");
        connector.setSkillCode("ima-skill");
        connector.setAuthMode("AK_SK");
        connector.setStatusCd("00A");
        connector.setRuntimeManifest("""
            {"schemaVersion":"1.0","id":"ima-openapi","version":"1.0.0",
             "runtime":{"type":"cli","authorizeIn":"be-auth-job","commands":{"version":[["ima","--version"]]}},
             "authStorage":{"mode":"managed-environment","owner":"be-auth-job",
               "runtimeMutation":"provider-refresh-only",
               "managedEnvironmentKeys":["IMA_OPENAPI_CLIENTID","IMA_OPENAPI_APIKEY"],"environment":{}},
             "skill":{"code":"ima-skill","source":"system-builtin","installScope":"user","grantScope":"agent"}}
            """);
        return connector;
    }
}
