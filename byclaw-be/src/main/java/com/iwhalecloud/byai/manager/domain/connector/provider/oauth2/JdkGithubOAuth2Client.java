package com.iwhalecloud.byai.manager.domain.connector.provider.oauth2;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Date;
import java.util.Base64;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

@Component
public class JdkGithubOAuth2Client implements GithubOAuth2Client {
    private static final String TOKEN_URL = "https://github.com/login/oauth/access_token";
    private static final String USER_URL = "https://api.github.com/user";
    private static final String REVOKE_URL_TEMPLATE = "https://api.github.com/applications/%s/grant";
    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;
    private final String tokenUrl;
    private final String userUrl;
    private final String revokeUrlTemplate;

    @Autowired
    public JdkGithubOAuth2Client(ObjectMapper objectMapper) {
        this(HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build(), objectMapper, TOKEN_URL, USER_URL,
            REVOKE_URL_TEMPLATE);
    }

    JdkGithubOAuth2Client(HttpClient httpClient, ObjectMapper objectMapper, String tokenUrl, String userUrl) {
        this(httpClient, objectMapper, tokenUrl, userUrl, REVOKE_URL_TEMPLATE);
    }

    JdkGithubOAuth2Client(HttpClient httpClient, ObjectMapper objectMapper, String tokenUrl, String userUrl,
            String revokeUrlTemplate) {
        this.httpClient = httpClient;
        this.objectMapper = objectMapper;
        this.tokenUrl = tokenUrl;
        this.userUrl = userUrl;
        this.revokeUrlTemplate = revokeUrlTemplate;
    }

    @Override
    public Token exchange(ExchangeRequest request) {
        String form = "client_id=" + encode(request.clientId())
            + "&client_secret=" + encode(request.clientSecret())
            + "&code=" + encode(request.code())
            + "&redirect_uri=" + encode(request.redirectUri())
            + "&code_verifier=" + encode(request.codeVerifier());
        JsonNode json = send(HttpRequest.newBuilder(URI.create(tokenUrl))
            .timeout(Duration.ofSeconds(10))
            .header("Accept", "application/json")
            .header("Content-Type", "application/x-www-form-urlencoded")
            .POST(HttpRequest.BodyPublishers.ofString(form)).build());
        if (json.hasNonNull("error")) {
            throw new IllegalStateException("GitHub token exchange rejected");
        }
        Date now = new Date();
        return new Token(text(json, "access_token"), text(json, "refresh_token"), text(json, "token_type"),
            text(json, "scope"), expiry(now, json, "expires_in"), expiry(now, json, "refresh_token_expires_in"));
    }

    @Override
    public User loadUser(String accessToken) {
        JsonNode json = send(HttpRequest.newBuilder(URI.create(userUrl))
            .timeout(Duration.ofSeconds(10))
            .header("Accept", "application/vnd.github+json")
            .header("Authorization", "Bearer " + accessToken)
            .header("X-GitHub-Api-Version", "2022-11-28")
            .GET().build());
        return new User(json.path("id").asText(null), text(json, "login"));
    }

    @Override
    public void revoke(RevokeRequest request) {
        String basic = Base64.getEncoder().encodeToString(
            (request.clientId() + ":" + request.clientSecret()).getBytes(StandardCharsets.UTF_8));
        HttpRequest httpRequest = HttpRequest.newBuilder(
                URI.create(String.format(revokeUrlTemplate, encode(request.clientId()))))
            .timeout(Duration.ofSeconds(10))
            .header("Accept", "application/vnd.github+json")
            .header("Authorization", "Basic " + basic)
            .header("Content-Type", "application/json")
            .method("DELETE", HttpRequest.BodyPublishers.ofString(
                "{\"access_token\":\"" + request.accessToken().replace("\\", "\\\\").replace("\"", "\\\"") + "\"}"))
            .build();
        try {
            HttpResponse<Void> response = httpClient.send(httpRequest, HttpResponse.BodyHandlers.discarding());
            if (response.statusCode() != 204) {
                throw new IllegalStateException("GitHub grant revocation failed");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("GitHub grant revocation interrupted", e);
        } catch (Exception e) {
            throw new IllegalStateException("GitHub grant revocation failed", e);
        }
    }

    private JsonNode send(HttpRequest request) {
        try {
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new IllegalStateException("GitHub OAuth2 HTTP request failed");
            }
            return objectMapper.readTree(response.body());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("GitHub OAuth2 request interrupted", e);
        } catch (Exception e) {
            throw new IllegalStateException("GitHub OAuth2 request failed", e);
        }
    }

    private String text(JsonNode json, String field) {
        return json.hasNonNull(field) ? json.get(field).asText() : null;
    }

    private Date expiry(Date now, JsonNode json, String field) {
        return json.hasNonNull(field) ? new Date(now.getTime() + json.get(field).asLong() * 1000L) : null;
    }

    private String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
