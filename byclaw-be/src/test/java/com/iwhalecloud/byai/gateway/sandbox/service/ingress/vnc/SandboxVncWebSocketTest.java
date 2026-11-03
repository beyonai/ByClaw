package com.iwhalecloud.byai.gateway.sandbox.service.ingress.vnc;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.springframework.web.socket.*;
import okhttp3.HttpUrl;

class SandboxVncWebSocketTest {
    @Test void sameOriginWorksBehindTlsTerminationAndRejectsCrossOrigin() {
        var servlet = new org.springframework.mock.web.MockHttpServletRequest("GET", "/sandbox/vnc/s/vnc/websockify");
        servlet.setScheme("http"); servlet.setServerName("www.beyonai.cn"); servlet.setServerPort(80);
        servlet.addHeader("Host", "www.beyonai.cn"); servlet.addHeader("X-Forwarded-Proto", "https");
        servlet.addHeader("Origin", "https://www.beyonai.cn");
        assertThat(SandboxVncWebSocketConfig.sameOrigin(new org.springframework.http.server.ServletServerHttpRequest(servlet))).isTrue();
        servlet.removeHeader("Origin"); servlet.addHeader("Origin", "https://attacker.invalid");
        assertThat(SandboxVncWebSocketConfig.sameOrigin(new org.springframework.http.server.ServletServerHttpRequest(servlet))).isFalse();
        servlet.removeHeader("Origin");
        assertThat(SandboxVncWebSocketConfig.sameOrigin(new org.springframework.http.server.ServletServerHttpRequest(servlet))).isFalse();
    }
    @Test void binaryFramesTravelBothWaysAndPortalCookiesNeverReachUpstream() throws Exception {
        try (ServerSocket server = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) {
            var received = new CompletableFuture<byte[]>();
            var headers = new CompletableFuture<String>();
            Thread peer = new Thread(() -> {
                try (Socket socket = server.accept()) {
                    socket.setSoTimeout(10000);
                    var input = socket.getInputStream();
                    var output = socket.getOutputStream();
                    StringBuilder handshake = new StringBuilder();
                    while (!handshake.toString().endsWith("\r\n\r\n")) handshake.append((char) input.read());
                    headers.complete(handshake.toString());
                    String key = handshake.toString().lines().filter(line -> line.toLowerCase().startsWith("sec-websocket-key:"))
                        .findFirst().orElseThrow().split(":",2)[1].trim();
                    String accept = Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-1")
                        .digest((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").getBytes(StandardCharsets.US_ASCII)));
                    output.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: "
                        + accept + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
                    byte[] rfb = "RFB 003.008\n".getBytes(StandardCharsets.US_ASCII);
                    output.write(130); output.write(rfb.length); output.write(rfb); output.flush();
                    assertThat(input.read()).isEqualTo(130);
                    int size = input.read() & 127; byte[] mask = input.readNBytes(4); byte[] payload = input.readNBytes(size);
                    for (int i=0; i<size; i++) payload[i] ^= mask[i%4];
                    received.complete(payload);
                } catch (Throwable failure) { received.completeExceptionally(failure); headers.completeExceptionally(failure); }
            }); peer.setDaemon(true); peer.start();
            WebSocketSession browser = mock(WebSocketSession.class);
            Map<String,Object> attributes = new ConcurrentHashMap<>();
            attributes.put(SandboxVncWebSocketHandler.TARGET, new SandboxVncTargetResolver.Target(
                HttpUrl.get("http://127.0.0.1:" + server.getLocalPort() + "/websockify"), Map.of("e2b-traffic-access-token", "trusted")));
            when(browser.getAttributes()).thenReturn(attributes); when(browser.isOpen()).thenReturn(true);
            when(browser.getId()).thenReturn("browser");
            var delivered = new CompletableFuture<byte[]>();
            doAnswer(call -> {
                WebSocketMessage<?> message = call.getArgument(0);
                if (message instanceof BinaryMessage binary) { byte[] bytes=new byte[binary.getPayloadLength()]; binary.getPayload().get(bytes); delivered.complete(bytes); }
                return null;
            }).when(browser).sendMessage(any());
            var handler = new SandboxVncWebSocketHandler(); handler.afterConnectionEstablished(browser);
            assertThat(new String(delivered.get(10, TimeUnit.SECONDS), StandardCharsets.US_ASCII)).isEqualTo("RFB 003.008\n");
            handler.handleBinaryMessage(browser, new BinaryMessage(new byte[]{1,2,3,4}));
            assertThat(received.get(10,TimeUnit.SECONDS)).containsExactly(1,2,3,4);
            assertThat(headers.get()).containsIgnoringCase("e2b-traffic-access-token: trusted").doesNotContain("SESSION", "Beyond-Token");
            handler.afterConnectionClosed(browser, CloseStatus.NORMAL);
            assertThat(attributes).doesNotContainKey("sandbox.vnc.upstream");
        }
    }
}
