package com.iwhalecloud.byai.manager.domain.connector.provider.media;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatusResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialFormProvider;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialFormVerification;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialRenewalMode;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialState;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import java.util.Date;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Component;

/** Validates the credential shape without invoking a billable digital-human API. */
@Component
public class VolcengineDigitalHumanCredentialFormProvider implements ConnectorCredentialFormProvider {

    public static final String PROVIDER_CODE = "volcengine-digital-human";
    public static final String CONFIG_ATTRIBUTE = "digitalHumanConfig";
    private static final Set<String> FIELDS = Set.of("accessKeyId", "secretAccessKey");

    @Override
    public String providerCode() {
        return PROVIDER_CODE;
    }

    @Override
    public CredentialFormVerification verify(String userId, ConnectorInfo connector, Map<String, String> credentials) {
        if (connector == null || !PROVIDER_CODE.equals(connector.getConnectorCode())
                || !PROVIDER_CODE.equals(connector.getProviderCode())) {
            throw new IllegalArgumentException("Invalid digital human connector template");
        }
        String config = JSON.toJSONString(configuration(credentials));
        return new CredentialFormVerification(AuthorizationStatusResult.connected(
            null, connector.getConnectorName(), CredentialState.READY, CredentialRenewalMode.NONE,
            null, null, new Date(), null, Map.of(CONFIG_ATTRIBUTE, config)), Map.of());
    }

    public static Map<String, Object> configuration(Map<String, String> credentials) {
        if (credentials == null || !credentials.keySet().equals(FIELDS)) {
            throw new IllegalArgumentException("Invalid digital human credential fields");
        }
        return Map.of(
            "schemaVersion", 1,
            "connectorCode", PROVIDER_CODE,
            "enabled", true,
            "accessKeyId", required(credentials, "accessKeyId", 512),
            "secretAccessKey", required(credentials, "secretAccessKey", 2048));
    }

    private static String required(Map<String, String> credentials, String key, int maximum) {
        String value = credentials.get(key);
        if (value == null || value.isBlank() || value.length() > maximum
                || value.chars().anyMatch(character -> Character.isWhitespace(character)
                    || Character.isISOControl(character))) {
            throw new IllegalArgumentException("Invalid digital human credential " + key);
        }
        return value;
    }
}
