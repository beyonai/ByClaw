package com.iwhalecloud.byai.manager.domain.connector.provider.oauth2;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;

class JdkMailOAuth2ClientTest {
    @Test
    void exchangesAuthorizationCodeAndLoadsMicrosoftProfile() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicReference<String> form = new AtomicReference<>();
        server.createContext("/token", exchange -> {
            form.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            respond(exchange, 200, "{\"access_token\":\"access\",\"refresh_token\":\"refresh\","
                + "\"token_type\":\"Bearer\",\"scope\":\"openid email\",\"expires_in\":3600}");
        });
        server.createContext("/profile", exchange -> respond(exchange, 200,
            "{\"id\":\"id-1\",\"mail\":null,\"userPrincipalName\":\"upn@example.com\"}"));
        server.start();
        try {
            JdkMailOAuth2Client client = client(server);
            MailOAuth2Client.Token token = client.exchange(new MailOAuth2Client.ExchangeRequest(
                MailOAuth2Client.Provider.MICROSOFT, "client", "secret", "code value",
                "https://app.example/callback", "verifier"));
            MailOAuth2Client.Profile profile = client.loadProfile(
                MailOAuth2Client.Provider.MICROSOFT, token.accessToken());

            assertThat(form.get()).contains("grant_type=authorization_code", "code=code+value",
                "redirect_uri=https%3A%2F%2Fapp.example%2Fcallback", "code_verifier=verifier");
            assertThat(profile.accountId()).isEqualTo("id-1");
            assertThat(profile.accountName()).isEqualTo("upn@example.com");
            assertThat(profile.accountAttributes()).containsOnlyKeys("principalName", "username");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void exchangesAndRefreshesUsingFormEncodingAndLoadsGmailProfile() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicReference<String> form = new AtomicReference<>();
        server.createContext("/token", exchange -> {
            form.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            respond(exchange, 200, "{\"access_token\":\"new-access\",\"refresh_token\":\"rotated\","
                + "\"token_type\":\"Bearer\",\"scope\":\"openid email\",\"expires_in\":3600}");
        });
        server.createContext("/profile", exchange -> {
            assertThat(exchange.getRequestHeaders().getFirst("Authorization")).isEqualTo("Bearer new-access");
            respond(exchange, 200, "{\"emailAddress\":\"user@example.com\"}");
        });
        server.createContext("/revoke", exchange -> respond(exchange, 200, "{}"));
        server.start();
        try {
            JdkMailOAuth2Client client = client(server);
            MailOAuth2Client.Token token = client.refresh(new MailOAuth2Client.RefreshRequest(
                MailOAuth2Client.Provider.GMAIL, "client", "secret", "old refresh", "openid email"));
            MailOAuth2Client.Profile profile = client.loadProfile(MailOAuth2Client.Provider.GMAIL,
                token.accessToken());

            assertThat(form.get()).contains("grant_type=refresh_token", "refresh_token=old+refresh")
                .doesNotContain("scope=");
            assertThat(token.refreshToken()).isEqualTo("rotated");
            assertThat(profile.accountId()).isEqualTo("user@example.com");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void rejectsNon2xxBadJsonOversizeAndEmptyTokenWithoutLeakingBody() throws Exception {
        for (Response response : new Response[] {
            new Response(500, "provider-secret-body"), new Response(200, "not-json"),
            new Response(200, "{\"access_token\":\"\"}"),
            new Response(200, "{\"x\":\"" + "a".repeat(1024 * 1024) + "\"}")
        }) {
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/token", exchange -> respond(exchange, response.status(), response.body()));
            server.start();
            try {
                assertThatThrownBy(() -> client(server).exchange(new MailOAuth2Client.ExchangeRequest(
                    MailOAuth2Client.Provider.GMAIL, "client", "secret", "code", "https://app/cb", "verifier")))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageNotContaining("provider-secret-body");
            } finally {
                server.stop(0);
            }
        }
    }

    @Test
    void classifiesServerAndAuthorizationFailuresWithoutResponseBody() throws Exception {
        for (Response response : new Response[] {
            new Response(503, "provider-secret"), new Response(401, "provider-secret")
        }) {
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/token", exchange -> respond(exchange, response.status(), response.body()));
            server.start();
            try {
                Throwable thrown = org.assertj.core.api.Assertions.catchThrowable(() -> client(server).exchange(
                    new MailOAuth2Client.ExchangeRequest(MailOAuth2Client.Provider.GMAIL, "client", "secret",
                        "code", "https://app/cb", "verifier")));
                assertThat(thrown).isInstanceOf(MailOAuth2ClientException.class)
                    .hasMessageNotContaining("provider-secret");
                assertThat(((MailOAuth2ClientException) thrown).retryable()).isEqualTo(response.status() == 503);
            } finally {
                server.stop(0);
            }
        }
    }

    @Test
    void classifiesTimeoutAndOAuthTemporaryErrorsAsRetryable() throws Exception {
        for (Response response : new Response[] {
            new Response(408, "{}"),
            new Response(400, "{\"error\":\"temporarily_unavailable\"}"),
            new Response(200, "{\"error\":\"server_error\"}")
        }) {
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/token", exchange -> respond(exchange, response.status(), response.body()));
            server.start();
            try {
                Throwable thrown = org.assertj.core.api.Assertions.catchThrowable(() -> client(server).exchange(
                    new MailOAuth2Client.ExchangeRequest(MailOAuth2Client.Provider.GMAIL, "client", "secret",
                        "code", "https://app/cb", "verifier")));
                assertThat(thrown).isInstanceOf(MailOAuth2ClientException.class);
                assertThat(((MailOAuth2ClientException) thrown).retryable()).isTrue();
            } finally {
                server.stop(0);
            }
        }
    }

    @Test
    void oversizedServerFailureRemainsRetryableAfterClosingBody() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/token", exchange -> respond(exchange, 503, "x".repeat(1024 * 1024 + 1)));
        server.start();
        try {
            Throwable thrown = org.assertj.core.api.Assertions.catchThrowable(() -> client(server).exchange(
                new MailOAuth2Client.ExchangeRequest(MailOAuth2Client.Provider.GMAIL, "client", "secret",
                    "code", "https://app/cb", "verifier")));
            assertThat(thrown).isInstanceOf(MailOAuth2ClientException.class);
            assertThat(((MailOAuth2ClientException) thrown).retryable()).isTrue();
        } finally {
            server.stop(0);
        }
    }

    @Test
    void rejectsChunkedOversizeJson() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/token", exchange -> {
            exchange.sendResponseHeaders(200, 0);
            byte[] chunk = "a".repeat(8192).getBytes(StandardCharsets.UTF_8);
            try {
                for (int i = 0; i < 256; i++) {
                    exchange.getResponseBody().write(chunk);
                }
            } catch (java.io.IOException ignored) {
                // Client is expected to close the stream immediately after reading MAX+1 bytes.
            } finally {
                exchange.close();
            }
        });
        server.start();
        try {
            assertThatThrownBy(() -> client(server).exchange(new MailOAuth2Client.ExchangeRequest(
                MailOAuth2Client.Provider.GMAIL, "client", "secret", "code", "https://app/cb", "verifier")))
                .isInstanceOf(MailOAuth2ClientException.class);
        } finally {
            server.stop(0);
        }
    }

    @Test
    void noContentLengthSubscriberCancelsImmediatelyAtLimitPlusOne() {
        JdkMailOAuth2Client.BoundedBodySubscriber subscriber =
            new JdkMailOAuth2Client.BoundedBodySubscriber(-1L, 200);
        TestSubscription subscription = new TestSubscription();
        subscriber.onSubscribe(subscription);
        byte[] chunk = new byte[8192];
        for (int i = 0; i < 128; i++) {
            subscriber.onNext(java.util.List.of(java.nio.ByteBuffer.wrap(chunk)));
        }
        subscriber.onNext(java.util.List.of(java.nio.ByteBuffer.wrap(new byte[1])));

        assertThat(subscription.cancelled).isTrue();
        assertThatThrownBy(() -> subscriber.getBody().toCompletableFuture().join())
            .hasCauseInstanceOf(MailOAuth2ClientException.class);
    }

    @Test
    void appliesRequestTimeout() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/token", exchange -> {
            try {
                Thread.sleep(250L);
                respond(exchange, 200, "{\"access_token\":\"late\"}");
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        });
        server.start();
        try {
            String base = "http://127.0.0.1:" + server.getAddress().getPort();
            JdkMailOAuth2Client.Endpoints endpoints = new JdkMailOAuth2Client.Endpoints(
                base + "/token", base + "/profile", base + "/revoke");
            JdkMailOAuth2Client client = new JdkMailOAuth2Client(HttpClient.newHttpClient(), new ObjectMapper(),
                Map.of(MailOAuth2Client.Provider.GMAIL, endpoints), Duration.ofMillis(50));

            assertThatThrownBy(() -> client.exchange(new MailOAuth2Client.ExchangeRequest(
                MailOAuth2Client.Provider.GMAIL, "client", "secret", "code", "https://app/cb", "verifier")))
                .isInstanceOf(IllegalStateException.class);
        } finally {
            server.stop(0);
        }
    }

    @Test
    void wholeOperationDeadlineCoversStalledBodyAfterHeaders() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/token", exchange -> {
            exchange.sendResponseHeaders(200, 0);
            exchange.getResponseBody().write("{\"access_token\":\"".getBytes(StandardCharsets.UTF_8));
            exchange.getResponseBody().flush();
            try {
                Thread.sleep(500L);
                exchange.getResponseBody().write("late\"}".getBytes(StandardCharsets.UTF_8));
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            } catch (java.io.IOException ignored) {
                // Timed-out client cancels the body subscription.
            } finally {
                exchange.close();
            }
        });
        server.start();
        try {
            String base = "http://127.0.0.1:" + server.getAddress().getPort();
            JdkMailOAuth2Client.Endpoints endpoints = new JdkMailOAuth2Client.Endpoints(
                base + "/token", base + "/profile", base + "/revoke");
            JdkMailOAuth2Client client = new JdkMailOAuth2Client(HttpClient.newHttpClient(), new ObjectMapper(),
                Map.of(MailOAuth2Client.Provider.GMAIL, endpoints), Duration.ofMillis(50));
            long started = System.nanoTime();

            Throwable thrown = org.assertj.core.api.Assertions.catchThrowable(() -> client.exchange(
                new MailOAuth2Client.ExchangeRequest(MailOAuth2Client.Provider.GMAIL, "client", "secret", "code",
                    "https://app/cb", "verifier")));

            assertThat(thrown).isInstanceOf(MailOAuth2ClientException.class);
            assertThat(((MailOAuth2ClientException) thrown).retryable()).isTrue();
            assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofMillis(300));
        } finally {
            server.stop(0);
        }
    }

    @Test
    @SuppressWarnings({"unchecked", "rawtypes"})
    void timeoutCancelsUnderlyingHttpFuture() {
        HttpClient httpClient = mock(HttpClient.class);
        java.util.concurrent.CompletableFuture<java.net.http.HttpResponse<byte[]>> pending =
            new java.util.concurrent.CompletableFuture<>();
        when(httpClient.sendAsync(any(java.net.http.HttpRequest.class),
            any(java.net.http.HttpResponse.BodyHandler.class))).thenReturn((java.util.concurrent.CompletableFuture) pending);
        JdkMailOAuth2Client.Endpoints endpoints = new JdkMailOAuth2Client.Endpoints(
            "https://fixed.example/token", "https://fixed.example/profile", "https://fixed.example/revoke");
        JdkMailOAuth2Client client = new JdkMailOAuth2Client(httpClient, new ObjectMapper(),
            Map.of(MailOAuth2Client.Provider.GMAIL, endpoints), Duration.ofMillis(10));

        assertThatThrownBy(() -> client.exchange(new MailOAuth2Client.ExchangeRequest(
            MailOAuth2Client.Provider.GMAIL, "client", "secret", "code", "https://app/cb", "verifier")))
            .isInstanceOf(MailOAuth2ClientException.class);
        assertThat(pending).isCancelled();
    }

    @Test
    void gmailRevokeAcceptsSuccessfulEmptyResponse() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicReference<String> form = new AtomicReference<>();
        server.createContext("/revoke", exchange -> {
            form.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            exchange.sendResponseHeaders(200, -1);
            exchange.close();
        });
        server.start();
        try {
            client(server).revoke(MailOAuth2Client.Provider.GMAIL, "access token");
            assertThat(form.get()).isEqualTo("token=access+token");
        } finally {
            server.stop(0);
        }
    }

    private JdkMailOAuth2Client client(HttpServer server) {
        String base = "http://127.0.0.1:" + server.getAddress().getPort();
        JdkMailOAuth2Client.Endpoints endpoints = new JdkMailOAuth2Client.Endpoints(
            base + "/token", base + "/profile", base + "/revoke");
        return new JdkMailOAuth2Client(HttpClient.newHttpClient(), new ObjectMapper(), Map.of(
            MailOAuth2Client.Provider.GMAIL, endpoints,
            MailOAuth2Client.Provider.MICROSOFT, endpoints));
    }

    private void respond(com.sun.net.httpserver.HttpExchange exchange, int status, String body) throws java.io.IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }

    private record Response(int status, String body) { }

    private static final class TestSubscription implements java.util.concurrent.Flow.Subscription {
        private boolean cancelled;
        @Override public void request(long count) { }
        @Override public void cancel() { cancelled = true; }
    }
}
