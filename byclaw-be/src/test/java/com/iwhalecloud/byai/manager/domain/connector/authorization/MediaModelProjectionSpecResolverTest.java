package com.iwhalecloud.byai.manager.domain.connector.authorization;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import org.junit.jupiter.api.Test;

class MediaModelProjectionSpecResolverTest {

    private final MediaModelProjectionSpecResolver resolver =
        new MediaModelProjectionSpecResolver(new ObjectMapper());

    @Test
    void resolvesTtsProjectionDeclaredByConnectorTemplate() {
        MediaModelProjectionSpecResolver.Projection projection = resolver.resolve(connector(
            "speech-generation-model", "TTS", "/by/.connector-auth/.model/custom/tts.json"));

        assertThat(projection.path()).isEqualTo("/by/.connector-auth/.model/custom/tts.json");
        assertThat(projection.modelType()).isEqualTo("TTS");
    }

    @Test
    void rejectsCapabilityThatDoesNotMatchConnectorTemplate() {
        assertThatThrownBy(() -> resolver.resolve(connector(
            "speech-generation-model", "IMAGE", "/by/.connector-auth/.model/image.json")))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("capability");
    }

    @Test
    void rejectsProjectionOutsidePrivateModelDirectory() {
        assertThatThrownBy(() -> resolver.resolve(connector(
            "speech-generation-model", "TTS", "/tmp/tts.json")))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("path");
    }

    private ConnectorInfo connector(String code, String capability, String path) {
        ConnectorInfo connector = new ConnectorInfo();
        connector.setConnectorCode(code);
        connector.setProviderCode(code);
        connector.setRuntimeManifest("""
            {"mediaModelProjection":{"schemaVersion":1,"capability":"%s","path":"%s"}}
            """.formatted(capability, path));
        return connector;
    }
}
