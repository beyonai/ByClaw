package com.iwhalecloud.byai.manager.domain.connector.provider.weixin;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/** JDK HTTP implementation pinned to Weixin's production token endpoint. */
@Component
public class JdkWeixinOfficialApiClient implements WeixinOfficialApiClient {

    private static final String TOKEN_ENDPOINT = "https://api.weixin.qq.com/cgi-bin/token";
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(10);
    private static final int MAX_RESPONSE_BYTES = 64 * 1024;

    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;

    public JdkWeixinOfficialApiClient() {
        this(HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build());
    }

    JdkWeixinOfficialApiClient(HttpClient httpClient) {
        this.httpClient = httpClient;
        this.objectMapper = new ObjectMapper().enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
    }

    @Override
    public Status verify(String appId, String appSecret) {
        HttpRequest request = HttpRequest.newBuilder(tokenUri(appId, appSecret))
            .timeout(REQUEST_TIMEOUT)
            .GET()
            .build();
        try {
            HttpResponse<InputStream> response = httpClient.send(request, HttpResponse.BodyHandlers.ofInputStream());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                closeQuietly(response.body());
                return Status.FAILED;
            }
            byte[] body = readBounded(response.body());
            if (body == null) {
                return Status.PROTOCOL_ERROR;
            }
            return parse(body);
        } catch (HttpTimeoutException e) {
            return Status.TIMEOUT;
        } catch (IOException e) {
            return Status.FAILED;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return Status.FAILED;
        } catch (RuntimeException e) {
            return Status.PROTOCOL_ERROR;
        }
    }

    private URI tokenUri(String appId, String appSecret) {
        String query = "grant_type=client_credential&appid=" + encode(appId) + "&secret=" + encode(appSecret);
        return URI.create(TOKEN_ENDPOINT + "?" + query);
    }

    private String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private byte[] readBounded(InputStream input) throws IOException {
        if (input == null) {
            return null;
        }
        try (input) {
            byte[] body = input.readNBytes(MAX_RESPONSE_BYTES + 1);
            return body.length > MAX_RESPONSE_BYTES ? null : body;
        }
    }

    private Status parse(byte[] body) {
        try {
            JsonNode root = objectMapper.readTree(body);
            if (root == null || !root.isObject()) {
                return Status.PROTOCOL_ERROR;
            }
            JsonNode errorCode = root.get("errcode");
            if (errorCode != null) {
                if (!errorCode.canConvertToInt()) {
                    return Status.PROTOCOL_ERROR;
                }
                return switch (errorCode.intValue()) {
                    case 40013, 40125 -> Status.INVALID_CREDENTIALS;
                    case 40164 -> Status.IP_NOT_ALLOWLISTED;
                    default -> Status.PROTOCOL_ERROR;
                };
            }
            JsonNode accessToken = root.get("access_token");
            if (accessToken == null || !accessToken.isTextual() || accessToken.textValue().isBlank()) {
                return Status.PROTOCOL_ERROR;
            }
            JsonNode expiresIn = root.get("expires_in");
            if (expiresIn != null && (!expiresIn.canConvertToInt() || expiresIn.intValue() <= 0)) {
                return Status.PROTOCOL_ERROR;
            }
            return Status.VALID;
        } catch (IOException | RuntimeException e) {
            return Status.PROTOCOL_ERROR;
        }
    }

    private void closeQuietly(InputStream input) {
        if (input == null) {
            return;
        }
        try {
            input.close();
        } catch (IOException ignored) {
            // The response is discarded and must not influence the verification result.
        }
    }
}
