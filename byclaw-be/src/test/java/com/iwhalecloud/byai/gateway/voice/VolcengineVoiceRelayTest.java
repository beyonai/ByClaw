package com.iwhalecloud.byai.gateway.voice;

import java.net.URI;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.common.jwt.JwtService;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.staticdata.StaticDataQueryApplicationService;
import com.iwhalecloud.byai.manager.entity.staticdata.ByaiSystemConfig;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpHeaders;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class VolcengineVoiceRelayTest {
    private final JwtService jwt = mock(JwtService.class);
    private final StaticDataQueryApplicationService configs = mock(StaticDataQueryApplicationService.class);
    private final OkHttpClient upstream = mock(OkHttpClient.class);
    private final WebSocketSession browser = mock(WebSocketSession.class);
    private final ObjectMapper json = new ObjectMapper();
    private final VolcengineVoiceRelay relay = new VolcengineVoiceRelay(jwt, configs, json, upstream);

    @BeforeEach
    void setup() {
        when(browser.getId()).thenReturn("browser");
    }

    @AfterEach
    void close() {
        relay.afterConnectionClosed(browser, CloseStatus.NORMAL);
    }

    @Test
    void rejectsUnauthenticatedAudioBeforeReadingConfigOrOpeningProvider() throws Exception {
        when(browser.isOpen()).thenReturn(true);
        relay.afterConnectionEstablished(browser);
        relay.handleMessage(browser, new BinaryMessage(packet(0x20, new byte[2])));
        verify(browser).close(CloseStatus.POLICY_VIOLATION);
        verifyNoInteractions(jwt, configs, upstream);
    }

    @Test
    void rejectsInvalidTokenBeforeReadingConfigOrOpeningProvider() throws Exception {
        when(browser.isOpen()).thenReturn(true);
        relay.afterConnectionEstablished(browser);
        relay.handleMessage(browser, new TextMessage("{\"token\":\"invalid\"}"));
        verify(jwt).verifyJwt("invalid", LoginInfo.class);
        verify(browser).close(CloseStatus.POLICY_VIOLATION);
        verifyNoInteractions(configs, upstream);
    }

    @Test
    void authenticatesBeforeStartingProviderAndRelaysFinalBinaryFrames() throws Exception {
        when(browser.isOpen()).thenReturn(true);
        LoginInfo login = new LoginInfo();
        login.setUserId(123L);
        when(jwt.verifyJwt("browser-token", LoginInfo.class)).thenReturn(login);
        ByaiSystemConfig config = new ByaiSystemConfig();
        config.setParamValue("""
            {"type":"volcengine-streaming-asr-v2","resourceId":"volc.seedasr.sauc.duration",
             "credentials":{"apiKeyEncrypted":"%s"}}
            """.formatted(Sm4Util.encrypt("test-key")));
        when(configs.getDcSystemConfig("VOICE_STREAM_SERVICE_CONFIG")).thenReturn(config);
        WebSocket socket = mock(WebSocket.class);
        when(socket.send(any(ByteString.class))).thenReturn(true);
        when(upstream.newWebSocket(any(), any())).thenReturn(socket);

        relay.afterConnectionEstablished(browser);
        relay.handleMessage(browser, new TextMessage("{\"token\":\"browser-token\"}"));
        var request = ArgumentCaptor.forClass(Request.class);
        var listener = ArgumentCaptor.forClass(WebSocketListener.class);
        var ordered = inOrder(jwt, configs, upstream);
        ordered.verify(jwt).verifyJwt("browser-token", LoginInfo.class);
        ordered.verify(configs).getDcSystemConfig("VOICE_STREAM_SERVICE_CONFIG");
        ordered.verify(upstream).newWebSocket(request.capture(), listener.capture());
        when(socket.request()).thenReturn(request.getValue());

        listener.getValue().onOpen(socket, null);
        ByteBuffer audio = packet(0x20, new byte[] {1, 2});
        ByteBuffer end = packet(0x22, new byte[0]);
        relay.handleMessage(browser, new BinaryMessage(audio));
        relay.handleMessage(browser, new BinaryMessage(end));
        ByteString providerReply = ByteString.encodeUtf8("reply");
        listener.getValue().onMessage(socket, providerReply);

        var sent = ArgumentCaptor.forClass(ByteString.class);
        var transport = inOrder(socket, browser);
        transport.verify(socket).send(sent.capture());
        transport.verify(browser).sendMessage(new TextMessage("{\"ready\":true}"));
        transport.verify(socket).send(ByteString.of(audio.duplicate()));
        transport.verify(socket).send(ByteString.of(end.duplicate()));
        transport.verify(browser).sendMessage(new BinaryMessage(providerReply.asByteBuffer()));

        ByteBuffer init = sent.getValue().asByteBuffer();
        assertThat(init.getInt()).isEqualTo(0x11101000);
        assertThat(init.getInt()).isEqualTo(init.remaining());
        var body = json.readTree(StandardCharsets.UTF_8.decode(init).toString());
        assertThat(body.path("audio").path("rate").asInt()).isEqualTo(16000);
        assertThat(body.path("request").path("model_name").asText()).isEqualTo("bigmodel");
        assertThat(body.path("user").path("uid").asText())
            .isEqualTo(request.getValue().header("X-Api-Request-Id"));

        relay.afterConnectionClosed(browser, CloseStatus.NORMAL);
        verify(socket).cancel();
    }

    @Test
    void acceptsPreservedAuthorityBehindTlsProxyAndRejectsDifferentOrigin() {
        HttpHeaders headers = new HttpHeaders();
        headers.set(HttpHeaders.HOST, "web.example:443");
        headers.setOrigin(URI.create("https://web.example").toString());
        assertThat(VoiceStreamWebSocketConfig.matchesBrowserAuthority(headers)).isTrue();
        headers.setOrigin("https://web.example:444");
        assertThat(VoiceStreamWebSocketConfig.matchesBrowserAuthority(headers)).isFalse();
        headers.setOrigin("https://other.example");
        assertThat(VoiceStreamWebSocketConfig.matchesBrowserAuthority(headers)).isFalse();
    }

    private static ByteBuffer packet(int type, byte[] body) {
        return ByteBuffer.allocate(8 + body.length)
            .put((byte) 0x11).put((byte) type).putShort((short) 0).putInt(body.length).put(body).flip();
    }
}
