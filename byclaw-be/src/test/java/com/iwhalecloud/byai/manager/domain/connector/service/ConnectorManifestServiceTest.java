package com.iwhalecloud.byai.manager.domain.connector.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class ConnectorManifestServiceTest {

    private static final Long USER_ID = 1001L;

    private UserPrivateParamMapper mapper;
    private SequenceService sequenceService;
    private ConnectorManifestCanonicalizer canonicalizer;
    private ConnectorManifestService service;

    @BeforeEach
    void setUp() {
        mapper = mock(UserPrivateParamMapper.class);
        sequenceService = mock(SequenceService.class);
        canonicalizer = new ConnectorManifestCanonicalizer(new ObjectMapper());
        service = new ConnectorManifestService(mapper, sequenceService, canonicalizer);
        when(mapper.insertConnectorSnapshotIgnoreConflict(any())).thenReturn(1);
        when(mapper.updateById(any())).thenReturn(1);
    }

    @Test
    void upsertAndEnableCreatesManagedEncryptedSnapshot() {
        when(mapper.selectOne(any())).thenReturn(null);
        when(sequenceService.nextVal()).thenReturn(9001L);
        ConnectorInfo connector = connector(manifest("1.0.52", "status"));

        boolean changed = service.upsertAndEnable(USER_ID, connector);

        assertThat(changed).isTrue();
        ArgumentCaptor<UserPrivateParam> captor = ArgumentCaptor.forClass(UserPrivateParam.class);
        verify(mapper).insertConnectorSnapshotIgnoreConflict(captor.capture());
        UserPrivateParam inserted = captor.getValue();
        assertThat(inserted.getParamId()).isEqualTo(9001L);
        assertThat(inserted.getUserId()).isEqualTo(USER_ID);
        assertThat(inserted.getParamKey()).isEqualTo("CONNECTOR_DINGTALK_MANIFEST");
        assertThat(inserted.getParamSource()).isEqualTo("CONNECTOR");
        assertThat(inserted.getSourceRef()).isEqualTo("dingtalk");
        assertThat(inserted.getStatus()).isEqualTo("NORMAL");
        assertThat(inserted.getDeleteFlag()).isEqualTo("0");
        assertThat(Sm4Util.decrypt(inserted.getParamValueCipher()))
            .isEqualTo(canonicalizer.canonicalize(connector, connector.getRuntimeManifest()));
    }

    @Test
    void upsertAndEnableSkipsEquivalentCanonicalContent() {
        ConnectorInfo connector = connector(manifest("1.0.52", "status"));
        UserPrivateParam existing = existing(connector, "NORMAL");
        when(mapper.selectOne(any())).thenReturn(existing);

        boolean changed = service.upsertAndEnable(USER_ID, connector);

        assertThat(changed).isFalse();
        verify(mapper, never()).updateById(any());
        verify(mapper, never()).insertConnectorSnapshotIgnoreConflict(any());
    }

    @Test
    void upsertAndEnableUpdatesConcurrentWinnerWhenInsertIsIgnored() {
        ConnectorInfo connector = connector(manifest("1.0.52", "status"));
        UserPrivateParam winner = existing(connector, "DISABLED");
        when(mapper.selectOne(any())).thenReturn(null, winner);
        when(mapper.insertConnectorSnapshotIgnoreConflict(any())).thenReturn(0);

        boolean changed = service.upsertAndEnable(USER_ID, connector);

        assertThat(changed).isTrue();
        assertThat(winner.getStatus()).isEqualTo("NORMAL");
        verify(mapper).updateById(winner);
    }

    @Test
    void upsertAndEnableUpdatesChangedContentAndRestoresDisabledSnapshot() {
        ConnectorInfo oldConnector = connector(manifest("1.0.51", "status"));
        ConnectorInfo latest = connector(manifest("1.0.52", "status"));
        UserPrivateParam existing = existing(oldConnector, "DISABLED");
        Date oldUpdateTime = existing.getUpdateTime();
        when(mapper.selectOne(any())).thenReturn(existing);

        boolean changed = service.upsertAndEnable(USER_ID, latest);

        assertThat(changed).isTrue();
        verify(mapper).updateById(existing);
        assertThat(existing.getStatus()).isEqualTo("NORMAL");
        assertThat(existing.getUpdateTime()).isAfter(oldUpdateTime);
        assertThat(Sm4Util.decrypt(existing.getParamValueCipher()))
            .isEqualTo(canonicalizer.canonicalize(latest, latest.getRuntimeManifest()));
    }

    @Test
    void disableRetainsSnapshotAndChangesOnlyStatus() {
        ConnectorInfo connector = connector(manifest("1.0.52", "status"));
        UserPrivateParam existing = existing(connector, "NORMAL");
        String cipher = existing.getParamValueCipher();
        when(mapper.selectOne(any())).thenReturn(existing);

        boolean changed = service.disable(USER_ID, connector);

        assertThat(changed).isTrue();
        verify(mapper).updateById(existing);
        assertThat(existing.getStatus()).isEqualTo("DISABLED");
        assertThat(existing.getDeleteFlag()).isEqualTo("0");
        assertThat(existing.getParamValueCipher()).isEqualTo(cipher);
    }

    private UserPrivateParam existing(ConnectorInfo connector, String status) {
        UserPrivateParam existing = new UserPrivateParam();
        existing.setParamId(7001L);
        existing.setUserId(USER_ID);
        existing.setParamKey("CONNECTOR_DINGTALK_MANIFEST");
        existing.setParamSource("CONNECTOR");
        existing.setSourceRef("dingtalk");
        existing.setParamValueCipher(Sm4Util.encrypt(canonicalizer.canonicalize(connector, connector.getRuntimeManifest())));
        existing.setStatus(status);
        existing.setDeleteFlag("0");
        existing.setUpdateTime(new Date(System.currentTimeMillis() - 1_000L));
        return existing;
    }

    private ConnectorInfo connector(String manifest) {
        ConnectorInfo connector = new ConnectorInfo();
        connector.setConnectorId(15L);
        connector.setConnectorCode("dingtalk");
        connector.setConnectorName("钉钉");
        connector.setRuntimeManifest(manifest);
        return connector;
    }

    private String manifest(String version, String commandName) {
        return """
            {
              "schemaVersion":"1.0",
              "id":"dingtalk",
              "version":"%s",
              "runtime":{"type":"cli","commands":{"%s":["dws","auth","status"]}},
              "authStorage":{"mode":"native-home","nativePath":"/by/.connector-auth/.dws",
                "environment":{"HOME":"/by/.connector-auth/.dws"}},
              "skill":{"code":"dws","source":"system-builtin","installScope":"user","grantScope":"agent"}
            }
            """.formatted(version, commandName);
    }
}
