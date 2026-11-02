package com.iwhalecloud.byai.manager.domain.connector.provider.deepseek;

import com.iwhalecloud.byai.common.i18n.I18nUtil;

import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatusResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialFormProvider;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialVerifier;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialFormVerification;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialRenewalMode;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialState;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorManifestService;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import java.util.Date;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Component;

@Component
public class DeepSeekWebSearchCredentialFormProvider
        implements ConnectorCredentialFormProvider, ConnectorCredentialVerifier {
    public static final String PROVIDER_CODE = "deepseek-web-search";
    public static final String API_KEY = "DEEPSEEK_WEB_SEARCH_API_KEY";
    public static final Set<String> MANAGED_KEYS = Set.of(API_KEY);
    private static final Set<String> FORM_KEYS = Set.of("apiKey");

    private final DeepSeekWebSearchClient client;
    private final ConnectorManifestService manifestService;

    public DeepSeekWebSearchCredentialFormProvider(
            DeepSeekWebSearchClient client, ConnectorManifestService manifestService) {
        this.client = client;
        this.manifestService = manifestService;
    }

    @Override
    public String providerCode() {
        return PROVIDER_CODE;
    }

    @Override
    public CredentialFormVerification verify(
            String userId, ConnectorInfo connector, Map<String, String> credentials) {
        String apiKey = validate(credentials);
        AuthorizationStatusResult status = probe(connector, apiKey);
        return new CredentialFormVerification(
            status, status.status() == AuthorizationStatus.CONNECTED ? Map.of(API_KEY, apiKey) : Map.of());
    }

    @Override
    public AuthorizationStatusResult verify(Long userId, ConnectorInfo connector) {
        try {
            Map<String, String> stored = manifestService.readManagedCredentialsForVerification(
                userId, connector, MANAGED_KEYS);
            if (!stored.keySet().equals(MANAGED_KEYS)) {
                return failed("CONNECTOR_CREDENTIAL_INVALID");
            }
            return probe(connector, stored.get(API_KEY));
        } catch (RuntimeException e) {
            return failed("CONNECTOR_CREDENTIAL_INVALID");
        }
    }

    private String validate(Map<String, String> credentials) {
        if (credentials == null || !credentials.keySet().equals(FORM_KEYS)) {
            throw new IllegalArgumentException(I18nUtil.get("connector.deepseek.fieldsInvalid"));
        }
        String apiKey = credentials.get("apiKey");
        if (apiKey == null || apiKey.isBlank() || apiKey.length() > 4096
                || apiKey.chars().anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException(I18nUtil.get("connector.deepseek.apiKeyInvalid"));
        }
        return apiKey;
    }

    private AuthorizationStatusResult probe(ConnectorInfo connector, String apiKey) {
        try {
            client.search(connector, apiKey, "DeepSeek", 1);
            return AuthorizationStatusResult.connected(
                null, "DeepSeek Web Search", CredentialState.READY, CredentialRenewalMode.NONE,
                null, null, new Date(), null);
        } catch (DeepSeekWebSearchException e) {
            return failed(e.getErrorCode());
        }
    }

    private AuthorizationStatusResult failed(String errorCode) {
        return new AuthorizationStatusResult(
            AuthorizationStatus.FAILED, null, null, null, null, errorCode,
            "DeepSeek Web Search credential verification failed");
    }
}
