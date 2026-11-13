package com.iwhalecloud.byai.gateway.voice;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.UUID;

import com.fasterxml.jackson.databind.JsonNode;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import okhttp3.Request;
import okio.ByteString;

final class VolcengineVoiceConfig {
    static final String PARAM_CODE = "VOICE_STREAM_SERVICE_CONFIG";
    private static final String ENDPOINT = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async";
    private static final Set<String> RESOURCES = Set.of("volc.seedasr.sauc.duration", "volc.seedasr.sauc.concurrent");

    private VolcengineVoiceConfig() {
    }

    static Request upstreamRequest(JsonNode config) {
        String resource = config.path("resourceId").asText();
        if (!"volcengine-streaming-asr-v2".equals(config.path("type").asText()) || !RESOURCES.contains(resource)) {
            throw new IllegalArgumentException("Invalid voice service configuration");
        }
        String requestId = UUID.randomUUID().toString();
        Request.Builder request = new Request.Builder().url(ENDPOINT)
            .header("X-Api-Resource-Id", resource)
            .header("X-Api-Connect-Id", requestId)
            .header("X-Api-Request-Id", requestId)
            .header("X-Api-Sequence", "-1");
        JsonNode credentials = config.path("credentials");
        if (credentials.has("apiKeyEncrypted")) {
            request.header("X-Api-Key", credential(credentials.path("apiKeyEncrypted")));
        } else {
            request.header("X-Api-App-Key", credential(config.path("appIdEncrypted")))
                .header("X-Api-Access-Key", credential(credentials.path("accessTokenEncrypted")));
        }
        return request.build();
    }

    static ByteString initialFrame(String requestId) {
        byte[] body = """
            {"user":{"uid":"%s"},
             "audio":{"format":"pcm","codec":"raw","rate":16000,"bits":16,"channel":1},
             "request":{"model_name":"bigmodel","enable_nonstream":true,"result_type":"full"}}
            """.formatted(requestId).getBytes(StandardCharsets.UTF_8);
        ByteBuffer packet = ByteBuffer.allocate(8 + body.length);
        packet.putInt(0x11101000).putInt(body.length).put(body).flip();
        return ByteString.of(packet);
    }

    private static String credential(JsonNode encrypted) {
        if (!encrypted.isTextual() || encrypted.textValue().isBlank()) {
            throw new IllegalArgumentException("Missing voice service credential");
        }
        String value = Sm4Util.decrypt(encrypted.textValue()).trim();
        if (value.isEmpty()) {
            throw new IllegalArgumentException("Empty voice service credential");
        }
        return value;
    }
}
