package com.iwhalecloud.byai.manager.domain.connector.provider.oauth2;

import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.Date;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

import org.springframework.util.StringUtils;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationCallback;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationSessionContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStartContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStartResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatusResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorAuthorizationProvider;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialRenewalProvider;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialRevoker;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialSecret;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialSecretStore;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialVerifier;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorProvisionalCredentialCleaner;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialRenewalMode;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialState;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;

public abstract class AbstractMailOAuth2AuthorizationProvider implements ConnectorAuthorizationProvider,
        ConnectorCredentialVerifier, ConnectorCredentialRevoker, ConnectorProvisionalCredentialCleaner,
        ConnectorCredentialRenewalProvider {
    private static final SecureRandom RANDOM = new SecureRandom();
    protected final MailOAuth2Client client;
    protected final ConnectorCredentialSecretStore secretStore;
    protected final ObjectMapper objectMapper;
    protected final OAuth2ClientSecretResolver secretResolver;

    protected AbstractMailOAuth2AuthorizationProvider(MailOAuth2Client client, ConnectorCredentialSecretStore secretStore,
            ObjectMapper objectMapper, OAuth2ClientSecretResolver secretResolver) {
        this.client = client;
        this.secretStore = secretStore;
        this.objectMapper = objectMapper;
        this.secretResolver = secretResolver;
    }

    protected abstract MailOAuth2Client.Provider mailProvider();
    protected abstract String authorizeUrl();
    protected abstract String displayName();

    protected Map<String, String> additionalAuthorizeParameters() {
        return Map.of();
    }

    protected Set<String> nonAccessTokenScopes() {
        return Set.of();
    }

    protected Set<String> requiredAccessTokenScopes() {
        return Set.of();
    }

    protected boolean requiresRefreshToken() {
        return false;
    }

    @Override
    public AuthorizationStartResult start(AuthorizationStartContext context) {
        try {
            Map<String, Object> config = context.providerConfig();
            String clientIdEnv = required(config, "clientIdEnv");
            String clientSecretEnv = required(config, "clientSecretEnv");
            String redirectUriEnv = required(config, "redirectUriEnv");
            String clientId = secretResolver.resolve(clientIdEnv);
            secretResolver.resolve(clientSecretEnv);
            String redirectUri = validRedirectUri(secretResolver.resolve(redirectUriEnv));
            String scope = required(config, "scope");
            if (!containsAllScopes(scope, requiredAccessTokenScopes())) {
                throw new IllegalArgumentException("OAuth2配置缺少必要scope");
            }
            String state = OAuth2State.create(context.authorizationId());
            String verifier = randomValue(64);
            Map<String, String> providerState = new LinkedHashMap<>();
            providerState.put("oauthState", state);
            providerState.put("codeVerifier", verifier);
            providerState.put("clientIdEnv", clientIdEnv);
            providerState.put("clientSecretEnv", clientSecretEnv);
            providerState.put("redirectUri", redirectUri);
            providerState.put("scope", scope);
            Map<String, String> params = new LinkedHashMap<>();
            params.put("client_id", clientId);
            params.put("redirect_uri", redirectUri);
            params.put("response_type", "code");
            params.put("scope", scope);
            params.put("state", state);
            params.put("code_challenge", base64Url(sha256(verifier)));
            params.put("code_challenge_method", "S256");
            params.putAll(additionalAuthorizeParameters());
            String url = authorizeUrl() + "?" + params.entrySet().stream()
                .map(entry -> encode(entry.getKey()) + "=" + encode(entry.getValue()))
                .collect(java.util.stream.Collectors.joining("&"));
            return new AuthorizationStartResult(AuthorizationStatus.PENDING, url,
                new Date(System.currentTimeMillis() + Duration.ofMinutes(10).toMillis()), context.authorizationId(),
                objectMapper.writeValueAsString(providerState), null, null);
        } catch (RuntimeException | com.fasterxml.jackson.core.JsonProcessingException e) {
            return new AuthorizationStartResult(AuthorizationStatus.FAILED, null, null, null, null,
                "OAUTH_PROVIDER_CONFIG_INVALID", displayName() + " OAuth2未配置完整，请联系管理员");
        }
    }

    @Override
    public AuthorizationStatusResult queryStatus(AuthorizationSessionContext session) {
        return new AuthorizationStatusResult(AuthorizationStatus.PENDING, null, null, null, null, null, null);
    }

    @Override
    public AuthorizationStatusResult handleCallback(AuthorizationSessionContext session, AuthorizationCallback callback) {
        if (callback == null || StringUtils.hasText(callback.error())) {
            return failure("OAUTH_DENIED", "用户拒绝或平台取消授权");
        }
        Map<String, String> state;
        try {
            state = readState(session.providerState());
        } catch (RuntimeException e) {
            return failure("OAUTH_STATE_INVALID", "OAuth2回调state无效");
        }
        if (!StringUtils.hasText(callback.code()) || !StringUtils.hasText(callback.state())
                || !callback.state().equals(state.get("oauthState"))
                || !session.authorizationId().equals(OAuth2State.authorizationId(callback.state()))) {
            return failure("OAUTH_STATE_INVALID", "OAuth2回调state无效");
        }
        try {
            MailOAuth2Client.Token token = client.exchange(new MailOAuth2Client.ExchangeRequest(mailProvider(),
                secretResolver.resolve(state.get("clientIdEnv")), secretResolver.resolve(state.get("clientSecretEnv")),
                callback.code(), state.get("redirectUri"), state.get("codeVerifier")));
            String savedScopes = token.scopes();
            if (!StringUtils.hasText(savedScopes)) {
                savedScopes = state.get("scope");
            } else if (!hasRequiredScopes(state.get("scope"), savedScopes)) {
                return failure("OAUTH_SCOPE_INSUFFICIENT", "OAuth2授权范围不足");
            }
            if (requiresRefreshToken() && !StringUtils.hasText(token.refreshToken())) {
                return failure("OAUTH_TOKEN_EXCHANGE_FAILED", "OAuth2令牌交换失败");
            }
            MailOAuth2Client.Profile profile = requireProfile(client.loadProfile(mailProvider(), token.accessToken()));
            String reference = secretStore.save(ConnectorCredentialSecret.forOAuth2(providerCode(), session.userId(),
                session.connectorId(), token.accessToken(), token.refreshToken(), token.tokenType(), savedScopes,
                token.accessExpiresAt(), token.refreshExpiresAt()));
            return connected(profile, token.accessExpiresAt(), token.refreshExpiresAt(), reference,
                StringUtils.hasText(token.refreshToken()));
        } catch (RuntimeException e) {
            return failure("OAUTH_TOKEN_EXCHANGE_FAILED", "OAuth2令牌交换失败");
        }
    }

    @Override
    public AuthorizationStatusResult verify(Long userId, ConnectorInfo connector) {
        try {
            ConnectorCredentialSecret secret = secretStore.findActive(userId.toString(), connector.getConnectorId(),
                providerCode()).orElseThrow();
            MailOAuth2Client.Profile profile = requireProfile(client.loadProfile(mailProvider(), secret.accessToken()));
            return connected(profile, secret.accessExpiresAt(), secret.refreshExpiresAt(),
                secret.credentialReference(), StringUtils.hasText(secret.refreshToken()));
        } catch (RuntimeException e) {
            return failure("CONNECTOR_CREDENTIAL_INVALID", "连接器凭证验证失败");
        }
    }

    @Override
    public AuthorizationStatusResult renew(Long userId, ConnectorInfo connector) {
        ConnectorCredentialSecret old;
        try {
            old = secretStore.findActive(userId.toString(), connector.getConnectorId(), providerCode()).orElse(null);
        } catch (RuntimeException e) {
            return failure("OAUTH_REFRESH_RETRYABLE", "OAuth2凭证稍后重试");
        }
        Date now = new Date();
        if (old == null || !StringUtils.hasText(old.refreshToken())
                || old.refreshExpiresAt() != null && !old.refreshExpiresAt().after(now)) {
            return failure("OAUTH_REFRESH_UNAVAILABLE", "OAuth2凭证需要重新授权");
        }
        String clientId;
        String clientSecret;
        try {
            JsonNode config = objectMapper.readTree(connector.getAuthConfig());
            clientId = secretResolver.resolve(required(config, "clientIdEnv"));
            clientSecret = secretResolver.resolve(required(config, "clientSecretEnv"));
        } catch (RuntimeException | com.fasterxml.jackson.core.JsonProcessingException e) {
            return failure("OAUTH_REFRESH_UNAVAILABLE", "OAuth2凭证需要重新授权");
        }
        try {
            MailOAuth2Client.Token refreshed = client.refresh(new MailOAuth2Client.RefreshRequest(mailProvider(),
                clientId, clientSecret, old.refreshToken(), old.grantedScopes()));
            String refreshToken = StringUtils.hasText(refreshed.refreshToken())
                ? refreshed.refreshToken() : old.refreshToken();
            Date refreshExpiry = refreshed.refreshExpiresAt() != null
                ? refreshed.refreshExpiresAt() : old.refreshExpiresAt();
            String scopes = StringUtils.hasText(refreshed.scopes()) ? refreshed.scopes() : old.grantedScopes();
            if (StringUtils.hasText(refreshed.scopes()) && !hasRequiredScopes(old.grantedScopes(), scopes)) {
                return failure("OAUTH_REFRESH_UNAVAILABLE", "OAuth2凭证需要重新授权");
            }
            String tokenType = StringUtils.hasText(refreshed.tokenType())
                ? refreshed.tokenType() : old.tokenType();
            ConnectorCredentialSecret replacement = ConnectorCredentialSecret.restored(old.credentialReference(),
                providerCode(), old.userId(), old.connectorId(), refreshed.accessToken(), refreshToken,
                tokenType, scopes, refreshed.accessExpiresAt(), refreshExpiry);
            secretStore.replace(old.credentialReference(), old.accessExpiresAt(), replacement);
            MailOAuth2Client.Profile profile = requireProfile(
                client.loadProfile(mailProvider(), refreshed.accessToken()));
            return connected(profile, refreshed.accessExpiresAt(), refreshExpiry, old.credentialReference(), true);
        } catch (MailOAuth2ClientException e) {
            return failure(e.retryable() ? "OAUTH_REFRESH_RETRYABLE" : "OAUTH_REFRESH_UNAVAILABLE",
                e.retryable() ? "OAuth2凭证稍后重试" : "OAuth2凭证需要重新授权");
        } catch (com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialRenewalConflictException e) {
            return failure("OAUTH_REFRESH_RETRYABLE", "OAuth2凭证稍后重试");
        } catch (RuntimeException e) {
            return failure("OAUTH_REFRESH_RETRYABLE", "OAuth2凭证稍后重试");
        }
    }

    @Override
    public void revoke(String userId, ConnectorInfo connector) {
        ConnectorCredentialSecret secret = secretStore.findActive(userId, connector.getConnectorId(), providerCode())
            .orElseThrow(() -> new IllegalArgumentException("OAuth2凭证不存在"));
        revokeRemote(secret.accessToken());
        secretStore.revoke(secret.credentialReference());
    }

    protected void revokeRemote(String accessToken) {
        client.revoke(mailProvider(), accessToken);
    }

    @Override
    public void cleanupProvisionalCredential(AuthorizationSessionContext session, String credentialReference) {
        ConnectorCredentialSecret secret = secretStore.findActive(session.userId(), session.connectorId(), providerCode())
            .orElse(null);
        if (secret != null && secret.credentialReference().equals(credentialReference)) {
            revokeRemote(secret.accessToken());
            secretStore.revoke(credentialReference);
        }
    }

    private MailOAuth2Client.Profile requireProfile(MailOAuth2Client.Profile profile) {
        if (profile == null || !StringUtils.hasText(profile.accountId()) || !StringUtils.hasText(profile.accountName())) {
            throw new IllegalStateException("OAuth2 profile invalid");
        }
        return profile;
    }

    private AuthorizationStatusResult connected(MailOAuth2Client.Profile profile, Date accessExpiry,
            Date refreshExpiry, String reference, boolean renewable) {
        return AuthorizationStatusResult.connected(profile.accountId(), profile.accountName(), CredentialState.READY,
            renewable ? CredentialRenewalMode.REFRESH_TOKEN : CredentialRenewalMode.CREDENTIAL_REISSUE,
            accessExpiry, refreshExpiry, new Date(), reference, profile.accountAttributes());
    }

    private AuthorizationStatusResult failure(String code, String message) {
        return new AuthorizationStatusResult(AuthorizationStatus.FAILED, null, null, null, null, code, message);
    }

    private Map<String, String> readState(String json) {
        try {
            return objectMapper.readValue(json, new TypeReference<Map<String, String>>() { });
        } catch (Exception e) {
            throw new IllegalArgumentException("OAuth2 state invalid", e);
        }
    }

    private boolean hasRequiredScopes(String requested, String granted) {
        Set<String> grantedSet = new HashSet<>();
        if (StringUtils.hasText(granted)) {
            for (String scope : granted.split("[,\\s]+")) {
                if (StringUtils.hasText(scope)) grantedSet.add(scope);
            }
        }
        Set<String> required = new HashSet<>(requiredAccessTokenScopes());
        if (StringUtils.hasText(requested)) {
            for (String scope : requested.split("\\s+")) {
                if (!nonAccessTokenScopes().contains(scope)) {
                    required.add(scope);
                }
            }
        }
        return grantedSet.containsAll(required);
    }

    private boolean containsAllScopes(String configured, Set<String> required) {
        Set<String> configuredScopes = new HashSet<>();
        if (StringUtils.hasText(configured)) {
            for (String scope : configured.split("\\s+")) {
                if (StringUtils.hasText(scope)) {
                    configuredScopes.add(scope);
                }
            }
        }
        return configuredScopes.containsAll(required);
    }

    private String required(Map<String, Object> config, String key) {
        Object value = config == null ? null : config.get(key);
        if (value == null || !StringUtils.hasText(value.toString())) throw new IllegalArgumentException(key);
        return value.toString();
    }

    private String required(JsonNode config, String key) {
        String value = config.path(key).asText(null);
        if (!StringUtils.hasText(value)) throw new IllegalArgumentException(key);
        return value;
    }

    private String validRedirectUri(String value) {
        URI uri = URI.create(value);
        boolean https = "https".equalsIgnoreCase(uri.getScheme());
        boolean loopbackHttp = "http".equalsIgnoreCase(uri.getScheme())
            && ("localhost".equalsIgnoreCase(uri.getHost()) || "127.0.0.1".equals(uri.getHost())
                || "::1".equals(uri.getHost()) || "[::1]".equals(uri.getHost()));
        if (!uri.isAbsolute() || (!https && !loopbackHttp) || !StringUtils.hasText(uri.getHost())
                || uri.getUserInfo() != null || uri.getFragment() != null) {
            throw new IllegalArgumentException("redirectUri");
        }
        return uri.toString();
    }

    private String randomValue(int bytes) {
        byte[] value = new byte[bytes];
        RANDOM.nextBytes(value);
        return base64Url(value);
    }

    private byte[] sha256(String value) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.US_ASCII));
        } catch (Exception e) {
            throw new IllegalStateException("PKCE摘要生成失败", e);
        }
    }

    private String base64Url(byte[] value) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
    }

    private String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
