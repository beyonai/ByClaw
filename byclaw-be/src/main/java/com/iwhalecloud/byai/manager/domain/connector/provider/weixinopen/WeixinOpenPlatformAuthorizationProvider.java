package com.iwhalecloud.byai.manager.domain.connector.provider.weixinopen;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Date;
import java.util.Map;

import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationCallback;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationSessionContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStartContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStartResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatusResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorAuthorizationProvider;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialRevoker;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialSecret;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialSecretStore;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialVerifier;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorProvisionalCredentialCleaner;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialRenewalMode;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialState;
import com.iwhalecloud.byai.manager.domain.connector.provider.oauth2.OAuth2State;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;

@Component
public class WeixinOpenPlatformAuthorizationProvider implements ConnectorAuthorizationProvider,
        ConnectorCredentialVerifier, ConnectorCredentialRevoker, ConnectorProvisionalCredentialCleaner {
    private static final String AUTHORIZE_URL = "https://mp.weixin.qq.com/cgi-bin/componentloginpage";
    private static final long REFRESH_SKEW_MILLIS = Duration.ofMinutes(5).toMillis();

    private final WeixinOpenPlatformConfigResolver configResolver;
    private final WeixinComponentTicketStore ticketStore;
    private final WeixinOpenPlatformClient client;
    private final ConnectorCredentialSecretStore secretStore;
    private final WeixinAuthorizerAuthStore authStore;
    private final ObjectMapper objectMapper;

    public WeixinOpenPlatformAuthorizationProvider(
            WeixinOpenPlatformConfigResolver configResolver,
            WeixinComponentTicketStore ticketStore,
            WeixinOpenPlatformClient client,
            ConnectorCredentialSecretStore secretStore,
            WeixinAuthorizerAuthStore authStore,
            ObjectMapper objectMapper) {
        this.configResolver = configResolver;
        this.ticketStore = ticketStore;
        this.client = client;
        this.secretStore = secretStore;
        this.authStore = authStore;
        this.objectMapper = objectMapper;
    }

    @Override
    public String providerCode() {
        return "weixin-open-platform";
    }

    @Override
    public AuthorizationStartResult start(AuthorizationStartContext context) {
        WeixinOpenPlatformConfig config;
        String ticket;
        try {
            config = configResolver.resolve(context.providerConfig());
            ticket = ticketStore.findCurrent(config.componentAppid())
                .orElseThrow(() -> new MissingTicketException());
        } catch (MissingTicketException e) {
            return failureStart("WEIXIN_COMPONENT_TICKET_UNAVAILABLE", "尚未收到微信平台票据，请稍后重试");
        } catch (RuntimeException e) {
            return failureStart("WEIXIN_COMPONENT_CONFIG_INVALID", "第三方平台配置不完整，请联系管理员");
        }
        String token;
        try {
            token = client.componentToken(config.componentAppid(), config.componentAppsecret(), ticket);
        } catch (WeixinOpenPlatformClientException e) {
            return providerFailureStart(e, "WEIXIN_COMPONENT_TOKEN_FAILED", "第三方平台令牌获取失败");
        }
        String preAuthCode;
        try {
            preAuthCode = client.createPreAuthCode(token, config.componentAppid());
        } catch (WeixinOpenPlatformClientException e) {
            return providerFailureStart(e, "WEIXIN_PREAUTH_CODE_FAILED", "微信预授权码获取失败");
        }
        String state = OAuth2State.create(context.authorizationId());
        String redirectUri = appendState(config.redirectUri(), state);
        String url = AUTHORIZE_URL
            + "?component_appid=" + encode(config.componentAppid())
            + "&pre_auth_code=" + encode(preAuthCode)
            + "&redirect_uri=" + encode(redirectUri)
            + "&auth_type=1";
        return new AuthorizationStartResult(
            AuthorizationStatus.PENDING, url,
            new Date(System.currentTimeMillis() + Duration.ofMinutes(10).toMillis()),
            context.authorizationId(), stateJson(state), null, null);
    }

    @Override
    public AuthorizationStatusResult queryStatus(AuthorizationSessionContext session) {
        return new AuthorizationStatusResult(AuthorizationStatus.PENDING, null, null, null, null, null, null);
    }

    @Override
    public AuthorizationStatusResult handleCallback(
            AuthorizationSessionContext session, AuthorizationCallback callback) {
        if (callback == null || StringUtils.hasText(callback.error())) {
            return failure("WEIXIN_AUTHORIZATION_CODE_INVALID", "授权已失效，请重新扫码");
        }
        try {
            String expectedState = readState(session.providerState());
            if (!StringUtils.hasText(callback.code()) || !expectedState.equals(callback.state())
                    || !session.authorizationId().equals(OAuth2State.authorizationId(callback.state()))
                    || session.expiresAt() == null || session.expiresAt().before(new Date())) {
                return failure("WEIXIN_AUTHORIZATION_CODE_INVALID", "授权已失效，请重新扫码");
            }
            WeixinOpenPlatformConfig config = configResolver.resolveDefault();
            String ticket = ticketStore.findCurrent(config.componentAppid())
                .orElseThrow(() -> new MissingTicketException());
            String componentToken = client.componentToken(
                config.componentAppid(), config.componentAppsecret(), ticket);
            WeixinOpenPlatformClient.AuthorizerToken token = client.queryAuthorization(
                componentToken, config.componentAppid(), callback.code());
            WeixinOpenPlatformClient.AuthorizerProfile profile = resolveProfile(
                componentToken, config.componentAppid(), token.authorizerAppid());
            String reference = secretStore.save(ConnectorCredentialSecret.forOAuth2(
                providerCode(), session.userId(), session.connectorId(), token.accessToken(), token.refreshToken(),
                "Bearer", token.grantedScopes(), token.accessExpiresAt(), null));
            return AuthorizationStatusResult.connected(
                profile.appid(), profile.nickname(), CredentialState.READY, CredentialRenewalMode.REFRESH_TOKEN,
                token.accessExpiresAt(), null, new Date(), reference,
                Map.of("username", profile.username(), "principalName", profile.principalName()));
        } catch (MissingTicketException e) {
            return failure("WEIXIN_COMPONENT_TICKET_UNAVAILABLE", "尚未收到微信平台票据，请稍后重试");
        } catch (WeixinOpenPlatformClientException e) {
            return failure(e.isTimeout() ? "CONNECTOR_VERIFICATION_TIMEOUT" : "WEIXIN_AUTHORIZATION_CODE_INVALID",
                e.isTimeout() ? "微信接口暂时超时，请稍后重试" : "授权已失效，请重新扫码");
        } catch (WeixinAuthorizerProfileException e) {
            return failure(e.isTimeout() ? "CONNECTOR_VERIFICATION_TIMEOUT" : "WEIXIN_AUTHORIZER_INFO_INVALID",
                e.isTimeout() ? "微信接口暂时超时，请稍后重试" : "微信返回的公众号资料不完整");
        } catch (RuntimeException e) {
            return failure("WEIXIN_AUTHORIZER_INFO_INVALID", "微信返回的公众号资料不完整");
        }
    }

    @Override
    public AuthorizationStatusResult verify(Long userId, ConnectorInfo connector) {
        if (userId == null || connector == null || connector.getConnectorId() == null) {
            return revoked();
        }
        String user = userId.toString();
        WeixinAuthorizerAuthStore.Binding binding;
        ConnectorCredentialSecret secret;
        try {
            binding = authStore.findActive(user, connector.getConnectorId()).orElse(null);
            secret = secretStore.findActive(user, connector.getConnectorId(), providerCode()).orElse(null);
        } catch (RuntimeException e) {
            return verificationUnavailable();
        }
        if (binding == null || secret == null) {
            return revoked();
        }
        try {
            if (secret.accessExpiresAt() == null
                    || secret.accessExpiresAt().getTime() <= System.currentTimeMillis() + REFRESH_SKEW_MILLIS) {
                WeixinOpenPlatformConfig config = configResolver.resolveDefault();
                String ticket = ticketStore.findCurrent(config.componentAppid())
                    .orElseThrow(() -> new MissingTicketException());
                String componentToken = client.componentToken(
                    config.componentAppid(), config.componentAppsecret(), ticket);
                WeixinOpenPlatformClient.AuthorizerToken refreshed = client.refreshAuthorizerToken(
                    componentToken, config.componentAppid(), binding.authorizerAppid(), secret.refreshToken());
                String reference = secretStore.save(ConnectorCredentialSecret.forOAuth2(
                    providerCode(), user, connector.getConnectorId(), refreshed.accessToken(),
                    refreshed.refreshToken(), "Bearer", secret.grantedScopes(), refreshed.accessExpiresAt(), null));
                return connected(binding, refreshed.accessExpiresAt(), reference);
            }
            return connected(binding, secret.accessExpiresAt(), secret.credentialReference());
        } catch (MissingTicketException e) {
            return failure("WEIXIN_COMPONENT_TICKET_UNAVAILABLE", "尚未收到微信平台票据，请稍后重试");
        } catch (WeixinOpenPlatformClientException e) {
            return failure(e.isTimeout() ? "CONNECTOR_VERIFICATION_TIMEOUT" : "WEIXIN_COMPONENT_TOKEN_FAILED",
                e.isTimeout() ? "微信接口暂时超时，请稍后重试" : "微信授权状态验证失败，请稍后重试");
        } catch (RuntimeException e) {
            return verificationUnavailable();
        }
    }

    @Override
    public void revoke(String userId, ConnectorInfo connector) {
        authStore.revoke(userId, connector.getConnectorId());
    }

    @Override
    public void cleanupProvisionalCredential(AuthorizationSessionContext session, String credentialReference) {
        secretStore.revoke(credentialReference);
    }

    private AuthorizationStatusResult connected(
            WeixinAuthorizerAuthStore.Binding account, Date expiry, String reference) {
        return AuthorizationStatusResult.connected(
            account.authorizerAppid(), account.nickname(), CredentialState.READY,
            CredentialRenewalMode.REFRESH_TOKEN, expiry, null, new Date(), reference,
            Map.of("username", account.username(), "principalName", account.principalName()));
    }

    private WeixinOpenPlatformClient.AuthorizerProfile resolveProfile(
            String componentToken, String componentAppid, String authorizerAppid) {
        try {
            return client.getAuthorizerInfo(componentToken, componentAppid, authorizerAppid);
        } catch (WeixinOpenPlatformClientException e) {
            throw new WeixinAuthorizerProfileException(e.isTimeout());
        }
    }

    private String stateJson(String state) {
        try {
            return objectMapper.writeValueAsString(Map.of("oauthState", state));
        } catch (Exception e) {
            throw new IllegalStateException("Weixin authorization state serialization failed");
        }
    }

    private String readState(String json) {
        try {
            Map<String, String> state = objectMapper.readValue(json, new TypeReference<Map<String, String>>() { });
            return state.get("oauthState");
        } catch (Exception e) {
            throw new IllegalArgumentException("Weixin authorization state is invalid");
        }
    }

    private String appendState(String redirectUri, String state) {
        return redirectUri + (redirectUri.contains("?") ? "&" : "?") + "state=" + encode(state);
    }

    private String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private AuthorizationStartResult failureStart(String code, String message) {
        return new AuthorizationStartResult(AuthorizationStatus.FAILED, null, null, null, null, code, message);
    }

    private AuthorizationStartResult providerFailureStart(
            WeixinOpenPlatformClientException error, String code, String message) {
        return error.isTimeout()
            ? failureStart("CONNECTOR_VERIFICATION_TIMEOUT", "微信接口暂时超时，请稍后重试")
            : failureStart(code, message);
    }

    private AuthorizationStatusResult failure(String code, String message) {
        return new AuthorizationStatusResult(AuthorizationStatus.FAILED, null, null, null, null, code, message);
    }

    private AuthorizationStatusResult revoked() {
        return failure("WEIXIN_AUTHORIZATION_REVOKED", "公众号已取消授权，请重新连接");
    }

    private AuthorizationStatusResult verificationUnavailable() {
        return failure("WEIXIN_COMPONENT_TOKEN_FAILED", "微信授权状态验证失败，请稍后重试");
    }

    private static final class MissingTicketException extends RuntimeException {
    }

}
