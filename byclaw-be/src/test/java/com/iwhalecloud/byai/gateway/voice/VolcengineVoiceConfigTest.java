package com.iwhalecloud.byai.gateway.voice;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import okhttp3.Request;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class VolcengineVoiceConfigTest {
    private final ObjectMapper json = new ObjectMapper();

    @Test
    void usesCurrentConsoleKeyAndFixedUpstream() throws Exception {
        var config = json.readTree("""
            {"type":"volcengine-streaming-asr-v2","resourceId":"volc.seedasr.sauc.duration",
             "credentials":{"apiKeyEncrypted":"%s"},"url":"wss://untrusted.example"}
            """.formatted(Sm4Util.encrypt("test-key")));
        Request request = VolcengineVoiceConfig.upstreamRequest(config);
        assertThat(request.url().host()).isEqualTo("openspeech.bytedance.com");
        assertThat(request.url().encodedPath()).isEqualTo("/api/v3/sauc/bigmodel_async");
        assertThat(request.header("X-Api-Key")).isEqualTo("test-key");
        assertThat(request.header("X-Api-Resource-Id")).isEqualTo("volc.seedasr.sauc.duration");
        assertThat(request.header("X-Api-Connect-Id")).isNotBlank().isEqualTo(request.header("X-Api-Request-Id"));
    }

    @Test
    void usesLegacyConsoleCredentialsForV2() throws Exception {
        var config = json.readTree("""
            {"type":"volcengine-streaming-asr-v2","resourceId":"volc.seedasr.sauc.concurrent",
             "appIdEncrypted":"%s","credentials":{"accessTokenEncrypted":"%s"}}
            """.formatted(Sm4Util.encrypt("test-app"), Sm4Util.encrypt("test-token")));
        Request request = VolcengineVoiceConfig.upstreamRequest(config);
        assertThat(request.header("X-Api-Key")).isNull();
        assertThat(request.header("X-Api-App-Key")).isEqualTo("test-app");
        assertThat(request.header("X-Api-Access-Key")).isEqualTo("test-token");
    }

    @Test
    void rejectsAnotherProviderOrResource() throws Exception {
        assertThatThrownBy(() -> VolcengineVoiceConfig.upstreamRequest(json.readTree("""
            {"type":"xunfei-spark-asr-v2"}
            """))).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> VolcengineVoiceConfig.upstreamRequest(json.readTree("""
            {"type":"volcengine-streaming-asr-v2","resourceId":"volc.bigasr.sauc.duration"}
            """))).isInstanceOf(IllegalArgumentException.class);
    }
}
