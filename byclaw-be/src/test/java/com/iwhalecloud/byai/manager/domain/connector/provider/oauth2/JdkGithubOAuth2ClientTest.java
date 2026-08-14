package com.iwhalecloud.byai.manager.domain.connector.provider.oauth2;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;

class JdkGithubOAuth2ClientTest {
    @Test
    void exchangesTokenAndLoadsAuthenticatedUser() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicReference<String> form = new AtomicReference<>();
        server.createContext("/token", exchange -> {
            form.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] body = "{\"access_token\":\"token\",\"scope\":\"read:user\",\"token_type\":\"bearer\"}"
                .getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.createContext("/user", exchange -> {
            assertThat(exchange.getRequestHeaders().getFirst("Authorization")).isEqualTo("Bearer token");
            byte[] body = "{\"id\":42,\"login\":\"octocat\"}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        try {
            String base = "http://127.0.0.1:" + server.getAddress().getPort();
            JdkGithubOAuth2Client client = new JdkGithubOAuth2Client(
                HttpClient.newHttpClient(), new ObjectMapper(), base + "/token", base + "/user"
            );
            GithubOAuth2Client.Token token = client.exchange(new GithubOAuth2Client.ExchangeRequest(
                "client", "secret", "code", "https://app/callback", "verifier"
            ));
            GithubOAuth2Client.User user = client.loadUser(token.accessToken());

            assertThat(form.get()).contains("client_id=client", "code_verifier=verifier");
            assertThat(token.accessToken()).isEqualTo("token");
            assertThat(user).isEqualTo(new GithubOAuth2Client.User("42", "octocat"));
        } finally {
            server.stop(0);
        }
    }

    @Test
    void revokesGrantWithBasicAuthenticationAndAccessTokenBody() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicReference<String> authorization = new AtomicReference<>();
        AtomicReference<String> body = new AtomicReference<>();
        AtomicReference<String> method = new AtomicReference<>();
        server.createContext("/applications/client/grant", exchange -> {
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            body.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            method.set(exchange.getRequestMethod());
            exchange.sendResponseHeaders(204, -1);
            exchange.close();
        });
        server.start();
        try {
            String base = "http://127.0.0.1:" + server.getAddress().getPort();
            JdkGithubOAuth2Client client = new JdkGithubOAuth2Client(
                HttpClient.newHttpClient(), new ObjectMapper(), base + "/token", base + "/user",
                base + "/applications/%s/grant"
            );

            client.revoke(new GithubOAuth2Client.RevokeRequest("client", "secret", "access-token"));

            assertThat(method.get()).isEqualTo("DELETE");
            assertThat(authorization.get()).isEqualTo("Basic " + Base64.getEncoder().encodeToString(
                "client:secret".getBytes(StandardCharsets.UTF_8)));
            assertThat(body.get()).isEqualTo("{\"access_token\":\"access-token\"}");
        } finally {
            server.stop(0);
        }
    }
}
