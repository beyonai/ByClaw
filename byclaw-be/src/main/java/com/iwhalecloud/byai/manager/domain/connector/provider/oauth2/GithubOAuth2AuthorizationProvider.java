package com.iwhalecloud.byai.manager.domain.connector.provider.oauth2;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationSessionContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationCallback;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStartContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStartResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatusResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorAuthorizationProvider;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialSecretStore;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialSecret;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialRenewalMode;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialState;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialRevoker;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialVerifier;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorProvisionalCredentialCleaner;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;

@Component
public class GithubOAuth2AuthorizationProvider
        implements ConnectorAuthorizationProvider, ConnectorCredentialVerifier, ConnectorCredentialRevoker,
        ConnectorProvisionalCredentialCleaner {
    private static final String AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
    private static final SecureRandom RANDOM = new SecureRandom();
    private final GithubOAuth2Client client;
    private final ConnectorCredentialSecretStore secretStore;
    private final ObjectMapper objectMapper;
    private final OAuth2ClientSecretResolver secretResolver;

    public GithubOAuth2AuthorizationProvider(GithubOAuth2Client client, ConnectorCredentialSecretStore secretStore,
            ObjectMapper objectMapper, OAuth2ClientSecretResolver secretResolver) {
        this.client = client;
        this.secretStore = secretStore;
        this.objectMapper = objectMapper;
        this.secretResolver = secretResolver;
    }

    @Override
    public String providerCode() {
        return "github-oauth2";
    }

    @Override
    public AuthorizationStartResult start(AuthorizationStartContext context) {
        String clientId;
        String clientSecretEnv;
        String scope;
        String redirectUri;
        try {
            clientId = clientId(context.providerConfig());
            clientSecretEnv = required(context.providerConfig(), "clientSecretEnv");
            // Fail before redirecting the user when the deployment forgot to provide the OAuth App secret.
            secretResolver.resolve(clientSecretEnv);
            scope = required(context.providerConfig(), "scope");
            redirectUri = redirectUri(context.providerConfig());
        } catch (RuntimeException e) {
            return new AuthorizationStartResult(
                AuthorizationStatus.FAILED,
                null,
                null,
                null,
                null,
                "OAUTH_PROVIDER_CONFIG_INVALID",
                "GitHub OAuth2未配置完整，请联系管理员"
            );
        }
        String state = OAuth2State.create(context.authorizationId());
        String verifier = randomValue(64);
        String challenge = base64Url(sha256(verifier));
        Map<String, String> providerState = new LinkedHashMap<>();
        providerState.put("oauthState", state);
        providerState.put("codeVerifier", verifier);
        providerState.put("redirectUri", redirectUri);
        providerState.put("clientId", clientId);
        providerState.put("clientSecretEnv", clientSecretEnv);
        providerState.put("scope", scope);
        String url = AUTHORIZE_URL + "?client_id=" + encode(clientId)
            + "&redirect_uri=" + encode(redirectUri)
            + "&scope=" + encode(scope)
            + "&state=" + encode(state)
            + "&code_challenge=" + encode(challenge)
            + "&code_challenge_method=S256";
        return new AuthorizationStartResult(AuthorizationStatus.PENDING, url,
            new Date(System.currentTimeMillis() + Duration.ofMinutes(10).toMillis()), context.authorizationId(),
            json(providerState), null, null);
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
        Map<String, String> state = readState(session.providerState());
        if (!StringUtils.hasText(callback.code()) || !StringUtils.hasText(callback.state())
                || !callback.state().equals(state.get("oauthState"))
                || !session.authorizationId().equals(OAuth2State.authorizationId(callback.state()))) {
            return failure("OAUTH_STATE_INVALID", "OAuth2回调state无效");
        }
        try {
            GithubOAuth2Client.Token token = client.exchange(new GithubOAuth2Client.ExchangeRequest(
                state.get("clientId"), secretResolver.resolve(state.get("clientSecretEnv")), callback.code(),
                state.get("redirectUri"), state.get("codeVerifier")
            ));
            if (token == null || !StringUtils.hasText(token.accessToken())) {
                return failure("OAUTH_TOKEN_EXCHANGE_FAILED", "OAuth2令牌交换失败");
            }
            if (!hasRequiredScopes(state.get("scope"), token.scopes())) {
                return failure("OAUTH_SCOPE_INSUFFICIENT", "OAuth2授权范围不足");
            }
            GithubOAuth2Client.User user = client.loadUser(token.accessToken());
            if (user == null || !StringUtils.hasText(user.id()) || !StringUtils.hasText(user.login())) {
                return failure("OAUTH_TOKEN_EXCHANGE_FAILED", "OAuth2账号验证失败");
            }
            String reference = secretStore.save(ConnectorCredentialSecret.forOAuth2(
                providerCode(), session.userId(), session.connectorId(), token.accessToken(), token.refreshToken(),
                token.tokenType(), token.scopes(), token.accessExpiresAt(), token.refreshExpiresAt()
            ));
            return AuthorizationStatusResult.connected(user.id(), user.login(), CredentialState.READY,
                StringUtils.hasText(token.refreshToken()) ? CredentialRenewalMode.REFRESH_TOKEN
                    : CredentialRenewalMode.CREDENTIAL_REISSUE,
                token.accessExpiresAt(), token.refreshExpiresAt(), new Date(), reference);
        } catch (RuntimeException e) {
            return failure("OAUTH_TOKEN_EXCHANGE_FAILED", "OAuth2令牌交换失败");
        }
    }

    private Map<String, String> readState(String json) {
        try {
            return objectMapper.readValue(json, new com.fasterxml.jackson.core.type.TypeReference<Map<String, String>>() { });
        } catch (Exception e) {
            throw new IllegalArgumentException("OAuth2会话数据无效", e);
        }
    }

    private AuthorizationStatusResult failure(String code, String message) {
        return new AuthorizationStatusResult(AuthorizationStatus.FAILED, null, null, null, null, code, message);
    }

    private boolean hasRequiredScopes(String requested, String granted) {
        java.util.Set<String> grantedScopes = new java.util.HashSet<>();
        if (StringUtils.hasText(granted)) {
            for (String scope : granted.split("[,\\s]+")) {
                if (StringUtils.hasText(scope)) {
                    grantedScopes.add(scope);
                }
            }
        }
        if (!StringUtils.hasText(requested)) {
            return true;
        }
        for (String scope : requested.split("\\s+")) {
            if (StringUtils.hasText(scope) && !grantedScopes.contains(scope)) {
                return false;
            }
        }
        return true;
    }

    @Override
    public void revoke(String userId, ConnectorInfo connector) {
        ConnectorCredentialSecret secret = secretStore.findActive(userId, connector.getConnectorId(), providerCode())
            .orElseThrow(() -> new IllegalArgumentException("OAuth2凭证不存在"));
        try {
            JsonNode config = objectMapper.readTree(connector.getAuthConfig());
            String clientId = config.path("clientId").asText(null);
            if (!StringUtils.hasText(clientId)) {
                clientId = secretResolver.resolve(config.path("clientIdEnv").asText(null));
            }
            String secretEnv = config.path("clientSecretEnv").asText(null);
            if (!StringUtils.hasText(clientId) || !StringUtils.hasText(secretEnv)) {
                throw new IllegalArgumentException("OAuth2配置无效");
            }
            client.revoke(new GithubOAuth2Client.RevokeRequest(
                clientId, secretResolver.resolve(secretEnv), secret.accessToken()));
            secretStore.revoke(secret.credentialReference());
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("OAuth2配置无效", e);
        }
    }

    @Override
    public AuthorizationStatusResult verify(Long userId, ConnectorInfo connector) {
        if (userId == null || connector == null || connector.getConnectorId() == null) {
            return failure("CONNECTOR_CREDENTIAL_INVALID", "连接器凭证不存在");
        }
        try {
            ConnectorCredentialSecret secret = secretStore.findActive(
                userId.toString(), connector.getConnectorId(), providerCode()).orElse(null);
            if (secret == null) {
                return failure("CONNECTOR_CREDENTIAL_INVALID", "连接器凭证不存在");
            }
            GithubOAuth2Client.User user = client.loadUser(secret.accessToken());
            if (user == null || !StringUtils.hasText(user.id()) || !StringUtils.hasText(user.login())) {
                return failure("CONNECTOR_CREDENTIAL_INVALID", "连接器凭证验证失败");
            }
            return AuthorizationStatusResult.connected(user.id(), user.login(), CredentialState.READY,
                StringUtils.hasText(secret.refreshToken()) ? CredentialRenewalMode.REFRESH_TOKEN
                    : CredentialRenewalMode.CREDENTIAL_REISSUE,
                secret.accessExpiresAt(), secret.refreshExpiresAt(), new Date(), secret.credentialReference());
        } catch (RuntimeException e) {
            return failure("CONNECTOR_CREDENTIAL_INVALID", "连接器凭证验证失败");
        }
    }

    @Override
    public void cleanupProvisionalCredential(AuthorizationSessionContext session, String credentialReference) {
        ConnectorCredentialSecret secret = secretStore.findActive(
            session.userId(), session.connectorId(), providerCode()).orElse(null);
        if (secret == null || !secret.credentialReference().equals(credentialReference)) {
            return;
        }
        Map<String, String> state = readState(session.providerState());
        client.revoke(new GithubOAuth2Client.RevokeRequest(
            state.get("clientId"), secretResolver.resolve(state.get("clientSecretEnv")), secret.accessToken()));
        secretStore.revoke(credentialReference);
    }

    private String required(Map<String, Object> config, String key) {
        Object value = config == null ? null : config.get(key);
        if (value == null || !StringUtils.hasText(value.toString())) {
            throw new IllegalArgumentException("OAuth2配置缺少" + key);
        }
        return value.toString();
    }

    private String clientId(Map<String, Object> config) {
        Object direct = config == null ? null : config.get("clientId");
        if (direct != null && StringUtils.hasText(direct.toString())) {
            return direct.toString();
        }
        return secretResolver.resolve(required(config, "clientIdEnv"));
    }

    private String redirectUri(Map<String, Object> config) {
        Object direct = config == null ? null : config.get("redirectUri");
        String value = direct != null && StringUtils.hasText(direct.toString())
            ? direct.toString() : secretResolver.resolve(required(config, "redirectUriEnv"));
        try {
            java.net.URI uri = java.net.URI.create(value);
            boolean https = "https".equalsIgnoreCase(uri.getScheme());
            boolean http = "http".equalsIgnoreCase(uri.getScheme());
            if (!uri.isAbsolute() || (!https && !http) || !StringUtils.hasText(uri.getHost())) {
                throw new IllegalArgumentException("OAuth2 redirectUri必须是HTTP或HTTPS绝对地址");
            }
            return uri.toString();
        } catch (RuntimeException e) {
            throw new IllegalArgumentException("OAuth2 redirectUri无效", e);
        }
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

    private String json(Map<String, String> value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("OAuth2会话序列化失败", e);
        }
    }
}
