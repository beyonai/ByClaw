package com.iwhalecloud.byai.manager.domain.connector.provider.media;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

class MediaModelConfigParserTest {

    private final MediaModelConfigParser parser = new MediaModelConfigParser(new ObjectMapper());

    @Test
    void normalizesCompleteTtsConfigurationWithoutLosingSecrets() {
        MediaModelConfig config = parser.parse(credentials(), MediaModelType.TTS, "speech-generation-model");

        assertThat(config.modelType()).isEqualTo(MediaModelType.TTS);
        assertThat(config.modelProtocol()).isEqualTo("VOLCENGINE_TTS_V3");
        assertThat(config.apiToken()).isEqualTo("test-secret");
        assertThat(config.headers()).containsExactly(new MediaModelHeader("X-Tenant", "tenant-a", true));
        assertThat(parser.serialize(config)).doesNotContain("system-default");
    }

    @Test
    void rejectsPrivateEndpoint() {
        Map<String, String> credentials = credentials();
        credentials.put("apiEndpoint", "https://169.254.169.254/latest/meta-data");

        assertThatThrownBy(() -> parser.parse(credentials, MediaModelType.TTS, "speech-generation-model"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("endpoint");
    }

    @Test
    void rejectsTransportControlHeader() {
        Map<String, String> credentials = credentials();
        credentials.put("headersJson", "[{\"name\":\"Host\",\"value\":\"evil\",\"sensitive\":false}]");

        assertThatThrownBy(() -> parser.parse(credentials, MediaModelType.TTS, "speech-generation-model"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("headers");
    }

    private Map<String, String> credentials() {
        Map<String, String> values = new LinkedHashMap<>();
        values.put("modelName", "My TTS");
        values.put("modelCode", "seed-tts-2.0");
        values.put("modelProtocol", "VOLCENGINE_TTS_V3");
        values.put("apiEndpoint", "https://openspeech.example.com/api/v3/tts/unidirectional");
        values.put("apiToken", "test-secret");
        values.put("headersJson", "[{\"name\":\"X-Tenant\",\"value\":\"tenant-a\",\"sensitive\":true}]");
        values.put("connectTimeoutSeconds", "32");
        values.put("readTimeoutSeconds", "60");
        values.put("maxRetryCount", "3");
        values.put("retryIntervalSeconds", "2");
        values.put("optionsJson", "{}");
        return values;
    }
}
