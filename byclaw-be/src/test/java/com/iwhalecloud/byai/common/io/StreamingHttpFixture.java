package com.iwhalecloud.byai.common.io;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/** A real HTTP response whose tail cannot arrive until the caller releases it. */
public final class StreamingHttpFixture implements AutoCloseable {
    public final HttpServer server;
    public final CountDownLatch release = new CountDownLatch(1);
    private final ExecutorService executor = Executors.newCachedThreadPool();
    public volatile String resourceId;
    public volatile String beyondToken;
    public volatile String requestPath;

    public StreamingHttpFixture() throws IOException { this(200); }

    public StreamingHttpFixture(int status) throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.setExecutor(executor);
        server.createContext("/", exchange -> {
            beyondToken = exchange.getRequestHeaders().getFirst("Beyond-Token");
            requestPath = exchange.getRequestURI().getPath();
            resourceId = exchange.getRequestHeaders().getFirst("X-Byclaw-Resource-Id");
            exchange.getRequestBody().transferTo(java.io.OutputStream.nullOutputStream());
            exchange.sendResponseHeaders(status, 0);
            try (var out = exchange.getResponseBody()) {
                byte[] buffer = new byte[8192];
                java.util.Arrays.fill(buffer, (byte) 'x');
                for (int i = 0; i < 16; i++) { out.write(buffer); }
                out.flush();
                release.await(10, TimeUnit.SECONDS);
                out.write(buffer);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            } catch (IOException closedByConsumer) {
                // Early consumer close is expected for these streaming ownership tests.
            } finally { exchange.close(); }
        });
        server.start();
    }

    public String url() { return "http://127.0.0.1:" + server.getAddress().getPort(); }
    public void close() { release.countDown(); server.stop(0); executor.shutdownNow(); }
}
