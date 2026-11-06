package com.iwhalecloud.byai.gateway.sandbox.service.ingress.desktop;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.iwhalecloud.byai.manager.domain.tenant.TenantContextInterceptor;
import com.iwhalecloud.byai.state.infrastructure.filter.AccessTokenVerifyInterceptor;
import java.io.*;
import java.net.ServerSocket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import okhttp3.HttpUrl;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.StaticApplicationContext;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;

class SandboxDesktopWebSocketTest {
    @Test
    void realServletWebSocketRelaysBinaryMessagesLargerThan64KiB() throws Exception {
        byte[] bytes = new byte[256 * 1024]; new Random(71).nextBytes(bytes);
        ExecutorService worker = Executors.newSingleThreadExecutor();
        org.apache.catalina.startup.Tomcat tomcat = new org.apache.catalina.startup.Tomcat();
        java.nio.file.Path base = java.nio.file.Files.createTempDirectory("desktop-ws-container-");
        tomcat.setBaseDir(base.toString()); tomcat.setPort(0); tomcat.getConnector();
        try (ServerSocket cloud = new ServerSocket(0, 1, java.net.InetAddress.getLoopbackAddress())) {
            Future<?> upstream = worker.submit(() -> {
                try (java.net.Socket socket = cloud.accept()) {
                    socket.setSoTimeout(10000);
                    InputStream in = socket.getInputStream(); OutputStream out = socket.getOutputStream();
                    ByteArrayOutputStream header = new ByteArrayOutputStream(); int b;
                    while ((b = in.read()) >= 0) { header.write(b); if (header.toString(StandardCharsets.US_ASCII).endsWith("\r\n\r\n")) break; }
                    String key = Arrays.stream(header.toString(StandardCharsets.US_ASCII).split("\r\n"))
                        .filter(line -> line.toLowerCase(Locale.ROOT).startsWith("sec-websocket-key:"))
                        .findFirst().orElseThrow().split(":", 2)[1].trim();
                    String accept = Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-1")
                        .digest((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").getBytes(StandardCharsets.US_ASCII)));
                    out.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII)); out.flush();
                    ByteArrayOutputStream received = new ByteArrayOutputStream();
                    boolean last;
                    do {
                        int opcode = in.read(); if (opcode < 0) throw new EOFException(); last = (opcode & 128) != 0;
                        int len = in.read(); boolean masked = (len & 128) != 0; long size = len & 127;
                        if (size == 126) size = new DataInputStream(in).readUnsignedShort();
                        else if (size == 127) size = new DataInputStream(in).readLong();
                        if (size < 0 || size > 1024 * 1024) throw new IOException("Invalid test frame size");
                        byte[] mask = masked ? in.readNBytes(4) : null, payload = in.readNBytes((int) size);
                        for (int i = 0; masked && i < payload.length; i++) payload[i] ^= mask[i % 4];
                        received.write(payload);
                    } while (!last);
                    assertThat(received.toByteArray()).isEqualTo(bytes);
                    out.write(0x82); out.write(127); new DataOutputStream(out).writeLong(bytes.length); out.write(bytes); out.flush();
                    Thread.sleep(200);
                    return null;
                }
            });
            var context = tomcat.addContext("", base.toString());
            context.addServletContainerInitializer(new org.apache.tomcat.websocket.server.WsSci(), Set.of());
            var web = new org.springframework.web.context.support.StaticWebApplicationContext();
            web.setServletContext(context.getServletContext());
            SandboxDesktopAccess access = mock(SandboxDesktopAccess.class);
            HttpUrl url = HttpUrl.parse("http://127.0.0.1:" + cloud.getLocalPort() + "/websockify");
            when(access.resolve(any(), eq(true))).thenReturn(new SandboxDesktopAccess.Target(url, url,
                Map.of("e2b-traffic-access-token", "cloud-fixture"), "/sandbox/desktop/exclusive/sb-1/vnc"));
            AccessTokenVerifyInterceptor auth = mock(AccessTokenVerifyInterceptor.class);
            TenantContextInterceptor tenant = mock(TenantContextInterceptor.class);
            when(auth.preHandle(any(), any(), any())).thenReturn(true); when(tenant.preHandle(any(), any(), any())).thenReturn(true);
            var mapping = new SandboxDesktopWebSocketConfig(access).desktopWebSocketHandlerMapping(new SandboxDesktopWebSocketProxyHandler(), auth, tenant);
            mapping.setApplicationContext(web); web.getBeanFactory().registerSingleton("desktopMapping", mapping); web.refresh();
            var servlet = org.apache.catalina.startup.Tomcat.addServlet(context, "desktop", new org.springframework.web.servlet.DispatcherServlet(web));
            servlet.setLoadOnStartup(1); context.addServletMappingDecoded("/", "desktop"); tomcat.start();
            CountDownLatch received = new CountDownLatch(1); ByteArrayOutputStream actual = new ByteArrayOutputStream();
            java.util.concurrent.atomic.AtomicInteger closeCode = new java.util.concurrent.atomic.AtomicInteger();
            java.net.http.WebSocket browser = java.net.http.HttpClient.newHttpClient().newWebSocketBuilder()
                .buildAsync(java.net.URI.create("ws://127.0.0.1:" + tomcat.getConnector().getLocalPort() + "/sandbox/desktop/exclusive/sb-1/vnc/websockify"), new java.net.http.WebSocket.Listener() {
                    @Override public void onOpen(java.net.http.WebSocket ws) { ws.request(1); }
                    @Override public CompletionStage<?> onBinary(java.net.http.WebSocket ws, java.nio.ByteBuffer data, boolean last) {
                        byte[] chunk = new byte[data.remaining()]; data.get(chunk); actual.writeBytes(chunk);
                        if (last) received.countDown(); ws.request(1); return null;
                    }
                    @Override public CompletionStage<?> onClose(java.net.http.WebSocket ws, int statusCode, String reason) {
                        closeCode.set(statusCode); return null;
                    }
                }).get(10, TimeUnit.SECONDS);
            browser.sendBinary(java.nio.ByteBuffer.wrap(bytes), true).get(5, TimeUnit.SECONDS);
            assertThat(received.await(5, TimeUnit.SECONDS)).as("browser close code=%s", closeCode.get()).isTrue();
            assertThat(actual.toByteArray()).isEqualTo(bytes);
            upstream.get(5, TimeUnit.SECONDS); browser.abort();
        } finally {
            tomcat.stop(); tomcat.destroy(); worker.shutdownNow();
            try (var paths = java.nio.file.Files.walk(base)) {
                for (var path : paths.sorted(Comparator.reverseOrder()).toList()) java.nio.file.Files.deleteIfExists(path);
            }
        }
    }

    @Test
    void websocketNeverFollowsAnUpstreamRedirectToAnotherAuthority() throws Exception {
        java.util.concurrent.atomic.AtomicInteger escaped = new java.util.concurrent.atomic.AtomicInteger();
        com.sun.net.httpserver.HttpServer outside = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
        outside.createContext("/", exchange -> { escaped.incrementAndGet(); exchange.sendResponseHeaders(403, -1); exchange.close(); });
        com.sun.net.httpserver.HttpServer cloud = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
        cloud.createContext("/", exchange -> {
            exchange.getResponseHeaders().add("Location", "http://127.0.0.1:" + outside.getAddress().getPort() + "/");
            exchange.sendResponseHeaders(302, -1); exchange.close();
        });
        outside.start(); cloud.start();
        try {
            WebSocketSession browser = mock(WebSocketSession.class); when(browser.isOpen()).thenReturn(true);
            Map<String, Object> attributes = new ConcurrentHashMap<>(); when(browser.getAttributes()).thenReturn(attributes);
            HttpUrl endpoint = HttpUrl.parse("http://127.0.0.1:" + cloud.getAddress().getPort() + "/");
            attributes.put(SandboxDesktopWebSocketProxyHandler.TARGET_ATTRIBUTE, new SandboxDesktopAccess.Target(
                endpoint, endpoint, Map.of("e2b-traffic-access-token", "cloud-fixture"), "/scoped"));
            CountDownLatch closed = new CountDownLatch(1);
            doAnswer(call -> { closed.countDown(); return null; }).when(browser).close(any(CloseStatus.class));
            new SandboxDesktopWebSocketProxyHandler().afterConnectionEstablished(browser);
            assertThat(closed.await(5, TimeUnit.SECONDS)).isTrue();
            assertThat(escaped.get()).isZero();
        } finally { cloud.stop(0); outside.stop(0); }
    }

    @Test
    void relaysCloudHeadersAndBinaryFramesWithoutBrowserLoginCredentials() throws Exception {
        byte[] serverBytes = {0, (byte) 255, 13};
        byte[] clientBytes = {5, 0, (byte) 200};
        ExecutorService worker = Executors.newSingleThreadExecutor();
        try (ServerSocket server = new ServerSocket(0, 1, java.net.InetAddress.getLoopbackAddress())) {
            Future<Map<String, String>> observed = worker.submit(() -> {
                try (java.net.Socket socket = server.accept()) {
                    socket.setSoTimeout(5000);
                    InputStream in = socket.getInputStream();
                    ByteArrayOutputStream raw = new ByteArrayOutputStream();
                    int next;
                    while ((next = in.read()) >= 0) {
                        raw.write(next);
                        if (raw.toString(StandardCharsets.US_ASCII).endsWith("\r\n\r\n")) break;
                        if (raw.size() > 65536) throw new IOException("Oversized test handshake");
                    }
                    Map<String, String> headers = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
                    for (String line : raw.toString(StandardCharsets.US_ASCII).split("\r\n")) {
                        int colon = line.indexOf(':');
                        if (colon > 0) headers.put(line.substring(0, colon), line.substring(colon + 1).trim());
                    }
                    String accept = Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-1")
                        .digest((headers.get("Sec-WebSocket-Key") + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").getBytes(StandardCharsets.US_ASCII)));
                    OutputStream out = socket.getOutputStream();
                    out.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: "
                        + accept + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
                    out.write(0x82); out.write(serverBytes.length); out.write(serverBytes); out.flush();
                    assertThat(in.read()).isEqualTo(0x82);
                    int length = in.read(); assertThat(length & 0x80).isNotZero();
                    byte[] mask = in.readNBytes(4), payload = in.readNBytes(length & 0x7f);
                    for (int i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
                    assertThat(payload).isEqualTo(clientBytes);
                    return headers;
                }
            });
            WebSocketSession browser = mock(WebSocketSession.class);
            Map<String, Object> attributes = new ConcurrentHashMap<>();
            HttpUrl endpoint = HttpUrl.parse("http://127.0.0.1:" + server.getLocalPort() + "/");
            attributes.put(SandboxDesktopWebSocketProxyHandler.TARGET_ATTRIBUTE, new SandboxDesktopAccess.Target(
                endpoint, endpoint.newBuilder().encodedPath("/websockify").addQueryParameter("sessionId", "shared").build(),
                Map.of("e2b-traffic-access-token", "cloud-fixture"), "/api/sandbox/desktop/exclusive/sb-1/vnc"));
            when(browser.getAttributes()).thenReturn(attributes); when(browser.isOpen()).thenReturn(true);
            CountDownLatch received = new CountDownLatch(1);
            doAnswer(call -> {
                assertThat(((BinaryMessage) call.getArgument(0)).getPayload().array()).isEqualTo(serverBytes);
                received.countDown(); return null;
            }).when(browser).sendMessage(any(BinaryMessage.class));
            SandboxDesktopWebSocketProxyHandler handler = new SandboxDesktopWebSocketProxyHandler();
            handler.afterConnectionEstablished(browser);
            handler.handleMessage(browser, new BinaryMessage(clientBytes));
            assertThat(received.await(5, TimeUnit.SECONDS)).isTrue();
            Map<String, String> headers = observed.get(5, TimeUnit.SECONDS);
            assertThat(headers.get("e2b-traffic-access-token")).isEqualTo("cloud-fixture");
            assertThat(headers).doesNotContainKeys("Cookie", "Beyond-Token", "Authorization");
            handler.afterConnectionClosed(browser, CloseStatus.NORMAL);
        } finally { worker.shutdownNow(); }
    }

    @Test
    void mappingAppliesAuthenticationAndTenantInterceptorsOnlyForUpgrade() throws Exception {
        SandboxDesktopAccess access = mock(SandboxDesktopAccess.class);
        AccessTokenVerifyInterceptor auth = mock(AccessTokenVerifyInterceptor.class);
        TenantContextInterceptor tenant = mock(TenantContextInterceptor.class);
        var mapping = new SandboxDesktopWebSocketConfig(access).desktopWebSocketHandlerMapping(
            new SandboxDesktopWebSocketProxyHandler(), auth, tenant);
        mapping.setApplicationContext(new StaticApplicationContext()); mapping.initApplicationContext();
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/sandbox/desktop/exclusive/sb-1/vnc/websockify");
        assertThat(mapping.getHandler(request)).isNull();
        request.addHeader("Upgrade", "websocket"); request.addHeader("Connection", "Upgrade");
        var chain = mapping.getHandler(request);
        assertThat(chain).isNotNull();
        assertThat(Arrays.asList(chain.getInterceptors())).containsSubsequence(auth, tenant);
    }

    @Test
    void rejectedHandshakeDoesNotRetainAnotherRequestsThreadIdentity() throws Exception {
        AccessTokenVerifyInterceptor auth = mock(AccessTokenVerifyInterceptor.class);
        TenantContextInterceptor tenant = mock(TenantContextInterceptor.class);
        var mapping = new SandboxDesktopWebSocketConfig(mock(SandboxDesktopAccess.class)).desktopWebSocketHandlerMapping(
            new SandboxDesktopWebSocketProxyHandler(), auth, tenant);
        mapping.setApplicationContext(new StaticApplicationContext());
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/sandbox/desktop/exclusive/sb-1/vnc/websockify");
        request.addHeader("Upgrade", "websocket"); request.addHeader("Connection", "Upgrade");
        var response = new org.springframework.mock.web.MockHttpServletResponse();
        var chain = mapping.getHandler(request);
        com.iwhalecloud.byai.common.login.bean.LoginInfo stale = new com.iwhalecloud.byai.common.login.bean.LoginInfo();
        stale.setUserCode("another-user");
        com.iwhalecloud.byai.common.login.auth.CurrentUserHolder.setLoginInfo(stale);
        when(auth.preHandle(request, response, chain.getHandler())).thenAnswer(call -> {
            assertThat(com.iwhalecloud.byai.common.login.auth.CurrentUserHolder.getLoginInfo()).isNull(); return false;
        });
        List<org.springframework.web.servlet.HandlerInterceptor> applied = new ArrayList<>();
        try {
            for (var interceptor : chain.getInterceptors()) {
                if (!interceptor.preHandle(request, response, chain.getHandler())) break;
                applied.add(interceptor);
            }
        } finally {
            Collections.reverse(applied);
            for (var interceptor : applied) interceptor.afterCompletion(request, response, chain.getHandler(), null);
        }
        verify(auth).preHandle(request, response, chain.getHandler());
        verifyNoInteractions(tenant);
        assertThat(com.iwhalecloud.byai.common.login.auth.CurrentUserHolder.getLoginInfo()).isNull();
    }
}
