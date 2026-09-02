package com.iwhalecloud.byai.manager.domain.connector.provider.weixin;

import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatusResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialFormProvider;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialVerifier;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialFormVerification;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialRenewalMode;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialState;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorManifestService;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;

/** Verifies and maps Official Account AppID/AppSecret credentials to managed runtime environment keys. */
@Component
public class WeixinOfficialApiCredentialProvider
        implements ConnectorCredentialFormProvider, ConnectorCredentialVerifier {

    public static final String PROVIDER_CODE = "weixin-official-api";
    public static final String APP_ID = "WECHAT_APPID";
    public static final String APP_SECRET = "WECHAT_APPSECRET";

    private static final Set<String> FORM_KEYS = Set.of("appId", "appSecret");
    private static final Set<String> MANAGED_KEYS = Set.of(APP_ID, APP_SECRET);

    private final WeixinOfficialApiClient client;
    private final ConnectorManifestService manifestService;

    public WeixinOfficialApiCredentialProvider(
            WeixinOfficialApiClient client,
            ConnectorManifestService manifestService) {
        this.client = client;
        this.manifestService = manifestService;
    }

    @Override
    public String providerCode() {
        return PROVIDER_CODE;
    }

    @Override
    public CredentialFormVerification verify(
            String userId,
            ConnectorInfo connector,
            Map<String, String> credentials) {
        Map<String, String> environment = validateAndMap(credentials);
        AuthorizationStatusResult status = probe(environment.get(APP_ID), environment.get(APP_SECRET));
        return status.status() == AuthorizationStatus.CONNECTED
            ? new CredentialFormVerification(status, environment)
            : new CredentialFormVerification(status, Map.of());
    }

    @Override
    public AuthorizationStatusResult verify(Long userId, ConnectorInfo connector) {
        if (userId == null || connector == null || manifestService == null) {
            return failed("CONNECTOR_CREDENTIAL_INVALID");
        }
        try {
            Map<String, String> stored = manifestService.readManagedCredentialsForVerification(
                userId, connector, MANAGED_KEYS);
            if (!stored.keySet().equals(MANAGED_KEYS)) {
                return failed("CONNECTOR_CREDENTIAL_INVALID");
            }
            validateValue(stored.get(APP_ID), 256, "appId");
            validateValue(stored.get(APP_SECRET), 2048, "appSecret");
            return probe(stored.get(APP_ID), stored.get(APP_SECRET));
        } catch (RuntimeException e) {
            return failed("CONNECTOR_CREDENTIAL_INVALID");
        }
    }

    private Map<String, String> validateAndMap(Map<String, String> credentials) {
        if (credentials == null || !credentials.keySet().equals(FORM_KEYS)) {
            throw new IllegalArgumentException("Weixin credentials must include exactly appId and appSecret");
        }
        String appId = credentials.get("appId");
        String appSecret = credentials.get("appSecret");
        validateValue(appId, 256, "appId");
        validateValue(appSecret, 2048, "appSecret");
        Map<String, String> environment = new LinkedHashMap<>();
        environment.put(APP_ID, appId);
        environment.put(APP_SECRET, appSecret);
        return Map.copyOf(environment);
    }

    private void validateValue(String value, int maxLength, String field) {
        if (value == null || value.trim().isEmpty() || value.length() > maxLength) {
            throw new IllegalArgumentException("Weixin " + field + " is invalid");
        }
        for (int i = 0; i < value.length(); i++) {
            if (Character.isISOControl(value.charAt(i))) {
                throw new IllegalArgumentException("Weixin " + field + " is invalid");
            }
        }
    }

    private AuthorizationStatusResult probe(String appId, String appSecret) {
        WeixinOfficialApiClient.Status result = client.verify(appId, appSecret);
        if (result == WeixinOfficialApiClient.Status.VALID) {
            return AuthorizationStatusResult.connected(
                null,
                "微信公众号 API",
                CredentialState.READY,
                CredentialRenewalMode.NONE,
                null,
                null,
                new Date(),
                null
            );
        }
        String errorCode = switch (result == null ? WeixinOfficialApiClient.Status.PROTOCOL_ERROR : result) {
            case INVALID_CREDENTIALS -> "CONNECTOR_CREDENTIAL_INVALID";
            case IP_NOT_ALLOWLISTED -> "WEIXIN_IP_NOT_ALLOWLISTED";
            case TIMEOUT -> "CONNECTOR_VERIFICATION_TIMEOUT";
            case FAILED -> "CONNECTOR_VERIFICATION_FAILED";
            case PROTOCOL_ERROR, VALID -> "PROVIDER_PROTOCOL_ERROR";
        };
        return failed(errorCode);
    }

    private AuthorizationStatusResult failed(String errorCode) {
        return new AuthorizationStatusResult(
            AuthorizationStatus.FAILED,
            null,
            null,
            null,
            null,
            errorCode,
            "Weixin Official Account credential verification failed"
        );
    }
}
