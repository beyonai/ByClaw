package com.iwhalecloud.byai.manager.domain.connector.authorization;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson.JSON;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.manager.domain.connector.provider.media.MediaModelConfigParser;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorConnectionStateService;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorAuthMapper;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorInfoMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class MediaModelConfigProjectionServiceTest extends com.iwhalecloud.byai.common.i18n.I18nTestSupport {

    @TempDir
    Path tempDir;

    private final Long userId = 1001L;
    private final Long connectorId = 2001L;
    private ConnectorCredentialWorkspaceService workspaceService;
    private ConnectorConnectionStateService connectionStateService;
    private ConnectorInfoMapper connectorInfoMapper;
    private Path projection;
    private MediaModelConfigProjectionService service;

    @BeforeEach
    void setUp() throws Exception {
        workspaceService = mock(ConnectorCredentialWorkspaceService.class);
        connectionStateService = mock(ConnectorConnectionStateService.class);
        connectorInfoMapper = mock(ConnectorInfoMapper.class);
        projection = Files.createDirectories(tempDir.resolve(".connector-auth/.model")).resolve("tts.json");
        when(workspaceService.resolveProjectionFile(userId, "/by/.connector-auth/.model/tts.json"))
            .thenReturn(projection);
        ConnectorPrivateFileProjectionWriter writer = new ConnectorPrivateFileProjectionWriter();
        org.springframework.test.util.ReflectionTestUtils.setField(writer, "platformPrivateFiles",
            new com.iwhalecloud.byai.gateway.sandbox.platform.PlatformPrivateFileSystemRouting(
                org.mockito.Mockito.mock(com.iwhalecloud.byai.gateway.sandbox.platform.PlatformRemoteGateway.class), ""));
        service = new MediaModelConfigProjectionService(
            workspaceService,
            writer,
            connectionStateService,
            connectorInfoMapper,
            mock(ConnectorAuthMapper.class),
            new MediaModelProjectionSpecResolver(new ObjectMapper()));
    }

    @Test
    void projectsCompleteEncryptedMediaConfiguration() throws Exception {
        ConnectorInfo connector = connector();
        ConnectorAuth auth = authorization("{\"schemaVersion\":1,\"revision\":\"rev-1\","
            + "\"connectorCode\":\"speech-generation-model\",\"modelType\":\"TTS\"}");
        when(connectionStateService.findEnabledActiveAuthorization("1001", connectorId)).thenReturn(auth);

        service.sync(userId, connector);

        assertThat(Files.readString(projection)).contains("\"revision\":\"rev-1\"")
            .contains("\"modelType\":\"TTS\"");
    }

    @Test
    void deleteRemovesOnlyTheConfiguredCapabilityFile() throws Exception {
        Files.writeString(projection, "secret");

        service.delete(userId, connector());

        assertThat(projection).doesNotExist();
    }

    private ConnectorInfo connector() {
        ConnectorInfo connector = new ConnectorInfo();
        connector.setConnectorId(connectorId);
        connector.setConnectorCode("speech-generation-model");
        connector.setProviderCode("speech-generation-model");
        connector.setStatusCd("00A");
        connector.setRuntimeManifest("""
            {"mediaModelProjection":{"schemaVersion":1,"capability":"TTS",
              "path":"/by/.connector-auth/.model/tts.json"}}
            """);
        return connector;
    }

    private ConnectorAuth authorization(String config) {
        ConnectorAuth auth = new ConnectorAuth();
        auth.setUserId("1001");
        auth.setConnectorId(connectorId);
        auth.setEnableFlag("Y");
        auth.setStatusCd("00A");
        auth.setCredentialState("READY");
        auth.setAuthCredential(Sm4Util.encrypt(JSON.toJSONString(Map.of(
            MediaModelConfigParser.MEDIA_MODEL_CONFIG_ATTRIBUTE, config))));
        return auth;
    }
}
