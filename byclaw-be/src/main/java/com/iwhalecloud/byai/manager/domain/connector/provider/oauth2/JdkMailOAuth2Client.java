package com.iwhalecloud.byai.manager.domain.connector.provider.oauth2;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.io.IOException;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Flow;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

@Component
public class JdkMailOAuth2Client implements MailOAuth2Client {
    private static final int MAX_JSON_BYTES = 1024 * 1024;
    private static final Duration DEFAULT_REQUEST_TIMEOUT = Duration.ofSeconds(10);
    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;
    private final Map<Provider, Endpoints> endpoints;
    private final Duration requestTimeout;

    @Autowired
    public JdkMailOAuth2Client(ObjectMapper objectMapper) {
        this(HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build(), objectMapper, Map.of(
            Provider.GMAIL, new Endpoints("https://oauth2.googleapis.com/token",
                "https://gmail.googleapis.com/gmail/v1/users/me/profile",
                "https://oauth2.googleapis.com/revoke"),
            Provider.MICROSOFT, new Endpoints(
                "https://login.microsoftonline.com/common/oauth2/v2.0/token",
                "https://graph.microsoft.com/v1.0/me", null)
        ), DEFAULT_REQUEST_TIMEOUT);
    }

    JdkMailOAuth2Client(HttpClient httpClient, ObjectMapper objectMapper, Map<Provider, Endpoints> endpoints) {
        this(httpClient, objectMapper, endpoints, DEFAULT_REQUEST_TIMEOUT);
    }

    JdkMailOAuth2Client(HttpClient httpClient, ObjectMapper objectMapper, Map<Provider, Endpoints> endpoints,
            Duration requestTimeout) {
        this.httpClient = httpClient;
        this.objectMapper = objectMapper;
        this.endpoints = Map.copyOf(endpoints);
        this.requestTimeout = requestTimeout;
    }

    @Override
    public Token exchange(ExchangeRequest request) {
        Map<String, String> form = new LinkedHashMap<>();
        form.put("client_id", request.clientId());
        form.put("client_secret", request.clientSecret());
        form.put("grant_type", "authorization_code");
        form.put("code", request.code());
        form.put("redirect_uri", request.redirectUri());
        form.put("code_verifier", request.codeVerifier());
        return token(request.provider(), form);
    }

    @Override
    public Token refresh(RefreshRequest request) {
        Map<String, String> form = new LinkedHashMap<>();
        form.put("client_id", request.clientId());
        form.put("client_secret", request.clientSecret());
        form.put("grant_type", "refresh_token");
        form.put("refresh_token", request.refreshToken());
        if (request.provider() == Provider.MICROSOFT && StringUtils.hasText(request.scopes())) {
            form.put("scope", request.scopes());
        }
        return token(request.provider(), form);
    }

    @Override
    public Profile loadProfile(Provider provider, String accessToken) {
        JsonNode json = send(HttpRequest.newBuilder(URI.create(endpoint(provider).profileUrl()))
            .timeout(requestTimeout).header("Accept", "application/json")
            .header("Authorization", "Bearer " + accessToken).GET().build());
        if (provider == Provider.GMAIL) {
            String email = text(json, "emailAddress");
            return new Profile(email, email, Map.of());
        }
        String id = text(json, "id");
        String mail = text(json, "mail");
        String principal = text(json, "userPrincipalName");
        Map<String, String> attributes = new LinkedHashMap<>();
        if (StringUtils.hasText(principal)) {
            attributes.put("principalName", principal);
            attributes.put("username", principal);
        }
        return new Profile(id, StringUtils.hasText(mail) ? mail : principal, attributes);
    }

    @Override
    public void revoke(Provider provider, String accessToken) {
        String revokeUrl = endpoint(provider).revokeUrl();
        if (!StringUtils.hasText(revokeUrl)) {
            throw new UnsupportedOperationException("Provider does not support token revocation");
        }
        sendWithoutBody(HttpRequest.newBuilder(URI.create(revokeUrl))
            .timeout(requestTimeout).header("Accept", "application/json")
            .header("Content-Type", "application/x-www-form-urlencoded")
            .POST(HttpRequest.BodyPublishers.ofString("token=" + encode(accessToken))).build());
    }

    private Token token(Provider provider, Map<String, String> form) {
        String body = form.entrySet().stream().map(entry -> encode(entry.getKey()) + "=" + encode(entry.getValue()))
            .collect(java.util.stream.Collectors.joining("&"));
        JsonNode json = send(HttpRequest.newBuilder(URI.create(endpoint(provider).tokenUrl()))
            .timeout(requestTimeout).header("Accept", "application/json")
            .header("Content-Type", "application/x-www-form-urlencoded")
            .POST(HttpRequest.BodyPublishers.ofString(body)).build());
        String accessToken = text(json, "access_token");
        if (!StringUtils.hasText(accessToken) || json.hasNonNull("error")) {
            boolean retryable = transientOAuthError(json);
            throw new MailOAuth2ClientException(retryable ? "OAUTH_RETRYABLE" : "TOKEN_REJECTED", retryable);
        }
        Date now = new Date();
        return new Token(accessToken, text(json, "refresh_token"), text(json, "token_type"),
            text(json, "scope"), expiry(now, json, "expires_in"), expiry(now, json, "refresh_token_expires_in"));
    }

    private JsonNode send(HttpRequest request) {
        CompletableFuture<HttpResponse<byte[]>> pending = httpClient.sendAsync(request,
            info -> new BoundedBodySubscriber(info.headers().firstValueAsLong("Content-Length").orElse(-1L),
                info.statusCode()));
        try {
            HttpResponse<byte[]> response = pending.get(requestTimeout.toMillis(), TimeUnit.MILLISECONDS);
            boolean success = response.statusCode() >= 200 && response.statusCode() < 300;
            byte[] body = response.body();
            JsonNode json = null;
            if (body.length > 0) {
                try {
                    json = objectMapper.readTree(body);
                } catch (IOException e) {
                    if (success) {
                        throw new MailOAuth2ClientException("RESPONSE_INVALID", false, e);
                    }
                }
            }
            if (!success) {
                throw statusFailure(response.statusCode(), json);
            }
            if (json == null || !json.isObject()) {
                throw new MailOAuth2ClientException("RESPONSE_INVALID", false);
            }
            return json;
        } catch (TimeoutException e) {
            pending.cancel(true);
            throw new MailOAuth2ClientException("TIMEOUT", true);
        } catch (InterruptedException e) {
            pending.cancel(true);
            Thread.currentThread().interrupt();
            throw new MailOAuth2ClientException("INTERRUPTED", true);
        } catch (ExecutionException e) {
            Throwable cause = e.getCause();
            if (cause instanceof MailOAuth2ClientException clientException) {
                throw clientException;
            }
            if (cause instanceof TimeoutException || cause instanceof HttpTimeoutException) {
                throw new MailOAuth2ClientException("TIMEOUT", true);
            }
            if (cause instanceof IOException) {
                throw new MailOAuth2ClientException("IO", true);
            }
            throw new MailOAuth2ClientException("IO", true);
        } catch (MailOAuth2ClientException e) {
            throw e;
        } catch (Exception e) {
            throw new MailOAuth2ClientException("RESPONSE_INVALID", false, e);
        }
    }

    private void sendWithoutBody(HttpRequest request) {
        CompletableFuture<HttpResponse<Void>> pending = httpClient.sendAsync(
            request, HttpResponse.BodyHandlers.discarding());
        try {
            HttpResponse<Void> response = pending.get(requestTimeout.toMillis(), TimeUnit.MILLISECONDS);
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw statusFailure(response.statusCode(), null);
            }
        } catch (TimeoutException e) {
            pending.cancel(true);
            throw new MailOAuth2ClientException("TIMEOUT", true);
        } catch (InterruptedException e) {
            pending.cancel(true);
            Thread.currentThread().interrupt();
            throw new MailOAuth2ClientException("INTERRUPTED", true);
        } catch (ExecutionException e) {
            Throwable cause = e.getCause();
            if (cause instanceof MailOAuth2ClientException clientException) {
                throw clientException;
            }
            throw new MailOAuth2ClientException("IO", true);
        } catch (MailOAuth2ClientException e) {
            throw e;
        }
    }

    private MailOAuth2ClientException statusFailure(int statusCode, JsonNode json) {
        boolean retryable = statusCode == 408 || statusCode == 429 || statusCode >= 500
            || transientOAuthError(json);
        return new MailOAuth2ClientException(retryable ? "HTTP_RETRYABLE" : "HTTP_PERMANENT", retryable);
    }

    private boolean transientOAuthError(JsonNode json) {
        String error = json == null ? null : text(json, "error");
        return "temporarily_unavailable".equals(error) || "server_error".equals(error);
    }

    private Endpoints endpoint(Provider provider) {
        Endpoints value = endpoints.get(provider);
        if (value == null) {
            throw new IllegalArgumentException("Unsupported mail OAuth2 provider");
        }
        return value;
    }

    private String text(JsonNode json, String field) {
        return json.hasNonNull(field) ? json.get(field).asText(null) : null;
    }

    private Date expiry(Date now, JsonNode json, String field) {
        return json.hasNonNull(field) ? new Date(now.getTime() + json.get(field).asLong() * 1000L) : null;
    }

    private String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    static final class BoundedBodySubscriber implements HttpResponse.BodySubscriber<byte[]> {
        private final CompletableFuture<byte[]> body = new CompletableFuture<>();
        private final ByteArrayOutputStream output = new ByteArrayOutputStream(Math.min(MAX_JSON_BYTES, 8192));
        private final boolean declaredOversize;
        private final int statusCode;
        private Flow.Subscription subscription;

        BoundedBodySubscriber(long contentLength, int statusCode) {
            this.declaredOversize = contentLength > MAX_JSON_BYTES;
            this.statusCode = statusCode;
        }

        @Override
        public CompletionStage<byte[]> getBody() {
            return body;
        }

        @Override
        public void onSubscribe(Flow.Subscription subscription) {
            this.subscription = subscription;
            if (declaredOversize) {
                subscription.cancel();
                body.completeExceptionally(oversizeFailure("RESPONSE_TOO_LARGE"));
            } else {
                subscription.request(1);
            }
        }

        @Override
        public void onNext(List<ByteBuffer> buffers) {
            if (body.isDone()) return;
            for (ByteBuffer buffer : buffers) {
                int allowed = MAX_JSON_BYTES + 1 - output.size();
                int count = Math.min(buffer.remaining(), allowed);
                byte[] chunk = new byte[count];
                buffer.get(chunk);
                output.writeBytes(chunk);
                if (output.size() > MAX_JSON_BYTES || buffer.hasRemaining()) {
                    subscription.cancel();
                    body.completeExceptionally(oversizeFailure("RESPONSE_SIZE_INVALID"));
                    return;
                }
            }
            subscription.request(1);
        }

        @Override
        public void onError(Throwable throwable) {
            body.completeExceptionally(throwable);
        }

        @Override
        public void onComplete() {
            body.complete(output.toByteArray());
        }

        private MailOAuth2ClientException oversizeFailure(String code) {
            boolean retryable = statusCode == 408 || statusCode == 429 || statusCode >= 500;
            return new MailOAuth2ClientException(retryable ? "HTTP_RETRYABLE" : code, retryable);
        }
    }

    record Endpoints(String tokenUrl, String profileUrl, String revokeUrl) { }
}
