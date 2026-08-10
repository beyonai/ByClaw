package com.iwhalecloud.byai.manager.domain.connector.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.manager.domain.connector.manifest.ConnectorManifestCanonicalizer;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.entity.users.UserPrivateParam;
import com.iwhalecloud.byai.manager.mapper.users.UserPrivateParamMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.util.Date;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class ConnectorManifestServiceTest {

    private static final Long USER_ID = 1001L;

    private UserPrivateParamMapper mapper;
    private SequenceService sequenceService;
    private ConnectorManifestService service;

    @BeforeEach
    void setUp() {
        mapper = org.mockito.Mockito.mock(UserPrivateParamMapper.class);
        sequenceService = org.mockito.Mockito.mock(SequenceService.class);
        service = new ConnectorManifestService(
            mapper,
            sequenceService,
            new ConnectorManifestCanonicalizer(new ObjectMapper())
        );
        when(mapper.insertConnectorParamIgnoreConflict(any())).thenReturn(1);
        when(mapper.updateById(any())).thenReturn(1);
    }

    @Test
    void upsertAndEnableCreatesOneEncryptedManagedRowPerEnvironmentEntry() {
        when(mapper.selectList(any())).thenReturn(List.of());
        when(sequenceService.nextVal()).thenReturn(9001L, 9002L, 9003L);

        boolean changed = service.upsertAndEnable(USER_ID, connector(dwsManifest()));

        assertThat(changed).isTrue();
        ArgumentCaptor<UserPrivateParam> captor = ArgumentCaptor.forClass(UserPrivateParam.class);
        verify(mapper, times(3)).insertConnectorParamIgnoreConflict(captor.capture());
        assertThat(captor.getAllValues())
            .extracting(UserPrivateParam::getParamKey)
            .containsExactly("DWS_CONFIG_DIR", "DWS_DISABLE_KEYCHAIN", "DWS_HOME");
        assertThat(captor.getAllValues())
            .allSatisfy(param -> {
                assertThat(param.getUserId()).isEqualTo(USER_ID);
                assertThat(param.getParamSource()).isEqualTo("CONNECTOR");
                assertThat(param.getSourceRef()).isEqualTo("dingtalk");
                assertThat(param.getStatus()).isEqualTo("NORMAL");
                assertThat(param.getDeleteFlag()).isEqualTo("0");
            });
        assertThat(captor.getAllValues())
            .extracting(param -> Sm4Util.decrypt(param.getParamValueCipher()))
            .containsExactly(
                "/by/.connector-auth/.dws/config",
                "1",
                "/by/.connector-auth/.dws"
            );
    }

    @Test
    void upsertAndEnableSkipsEquivalentActiveParameters() {
        List<UserPrivateParam> existing = List.of(
            existing("DWS_CONFIG_DIR", "/by/.connector-auth/.dws/config", "CONNECTOR", "dingtalk", "NORMAL"),
            existing("DWS_DISABLE_KEYCHAIN", "1", "CONNECTOR", "dingtalk", "NORMAL"),
            existing("DWS_HOME", "/by/.connector-auth/.dws", "CONNECTOR", "dingtalk", "NORMAL")
        );
        when(mapper.selectList(any())).thenReturn(existing);

        boolean changed = service.upsertAndEnable(USER_ID, connector(dwsManifest()));

        assertThat(changed).isFalse();
        verify(mapper, never()).insertConnectorParamIgnoreConflict(any());
        verify(mapper, never()).updateById(any());
    }

    @Test
    void upsertAndEnableUpdatesChangedValueRestoresDisabledAndDisablesStaleKey() {
        UserPrivateParam changedValue = existing(
            "DWS_CONFIG_DIR", "/old/config", "CONNECTOR", "dingtalk", "NORMAL");
        UserPrivateParam disabled = existing(
            "DWS_DISABLE_KEYCHAIN", "1", "CONNECTOR", "dingtalk", "DISABLED");
        UserPrivateParam current = existing(
            "DWS_HOME", "/by/.connector-auth/.dws", "CONNECTOR", "dingtalk", "NORMAL");
        UserPrivateParam stale = existing(
            "CONNECTOR_DINGTALK_MANIFEST", "{}", "CONNECTOR", "dingtalk", "NORMAL");
        when(mapper.selectList(any())).thenReturn(List.of(changedValue, disabled, current, stale));

        boolean changed = service.upsertAndEnable(USER_ID, connector(dwsManifest()));

        assertThat(changed).isTrue();
        assertThat(Sm4Util.decrypt(changedValue.getParamValueCipher()))
            .isEqualTo("/by/.connector-auth/.dws/config");
        assertThat(disabled.getStatus()).isEqualTo("NORMAL");
        assertThat(stale.getStatus()).isEqualTo("DISABLED");
        verify(mapper, times(3)).updateById(any());
        verify(mapper, never()).insertConnectorParamIgnoreConflict(any());
    }

    @Test
    void upsertAndEnableRejectsKeyOwnedByUserBeforeWritingAnything() {
        UserPrivateParam userOwned = existing(
            "DWS_HOME", "/custom/home", "USER", null, "NORMAL");
        when(mapper.selectList(any())).thenReturn(List.of(userOwned));

        assertThatThrownBy(() -> service.upsertAndEnable(USER_ID, connector(dwsManifest())))
            .isInstanceOf(ConnectorParameterConflictException.class)
            .hasMessageContaining("DWS_HOME");
        verify(mapper, never()).insertConnectorParamIgnoreConflict(any());
        verify(mapper, never()).updateById(any());
    }

    @Test
    void upsertAndEnableRejectsConcurrentWinnerOwnedByAnotherConnector() {
        when(mapper.selectList(any())).thenReturn(List.of());
        when(sequenceService.nextVal()).thenReturn(9001L);
        when(mapper.insertConnectorParamIgnoreConflict(any())).thenReturn(0);
        when(mapper.selectOne(any())).thenReturn(
            existing("DWS_CONFIG_DIR", "/other", "CONNECTOR", "other", "NORMAL"));

        assertThatThrownBy(() -> service.upsertAndEnable(USER_ID, connector(dwsManifest())))
            .isInstanceOf(ConnectorParameterConflictException.class)
            .hasMessageContaining("DWS_CONFIG_DIR");
    }

    @Test
    void disableChangesEveryActiveParameterForTheConnector() {
        UserPrivateParam first = existing(
            "DWS_HOME", "/by/.connector-auth/.dws", "CONNECTOR", "dingtalk", "NORMAL");
        UserPrivateParam second = existing(
            "DWS_CONFIG_DIR", "/by/.connector-auth/.dws/config", "CONNECTOR", "dingtalk", "NORMAL");
        UserPrivateParam alreadyDisabled = existing(
            "DWS_DISABLE_KEYCHAIN", "1", "CONNECTOR", "dingtalk", "DISABLED");
        when(mapper.selectList(any())).thenReturn(List.of(first, second, alreadyDisabled));

        boolean changed = service.disable(USER_ID, connector(dwsManifest()));

        assertThat(changed).isTrue();
        assertThat(first.getStatus()).isEqualTo("DISABLED");
        assertThat(second.getStatus()).isEqualTo("DISABLED");
        verify(mapper, times(2)).updateById(any());
    }

    private UserPrivateParam existing(
            String key,
            String value,
            String source,
            String sourceRef,
            String status) {
        UserPrivateParam param = new UserPrivateParam();
        param.setParamId((long) Math.abs(key.hashCode()));
        param.setUserId(USER_ID);
        param.setParamKey(key);
        param.setParamValueCipher(Sm4Util.encrypt(value));
        param.setParamSource(source);
        param.setSourceRef(sourceRef);
        if ("CONNECTOR".equals(source) && "dingtalk".equals(sourceRef)) {
            param.setDescription("系统托管连接器环境参数：钉钉 / " + key);
        }
        param.setStatus(status);
        param.setDeleteFlag("0");
        param.setUpdateTime(new Date(System.currentTimeMillis() - 1_000L));
        return param;
    }

    private ConnectorInfo connector(String manifest) {
        ConnectorInfo connector = new ConnectorInfo();
        connector.setConnectorId(15L);
        connector.setConnectorCode("dingtalk");
        connector.setConnectorName("钉钉");
        connector.setRuntimeManifest(manifest);
        return connector;
    }

    private String dwsManifest() {
        return """
            {
              "schemaVersion":"1.0",
              "id":"dingtalk",
              "version":"1.0.52",
              "runtime":{"type":"cli","commands":{"status":[["dws","auth","status"]]}},
              "authStorage":{"mode":"native-home","nativePath":"/by/.connector-auth/.dws",
                "environment":{
                  "DWS_HOME":"/by/.connector-auth/.dws",
                  "DWS_CONFIG_DIR":"/by/.connector-auth/.dws/config",
                  "DWS_DISABLE_KEYCHAIN":"1"
                }},
              "skill":{"code":"dws","source":"system-builtin","installScope":"user","grantScope":"agent"}
            }
            """;
    }
}
