package com.iwhalecloud.byai.manager.domain.mail;

import java.util.Arrays;
import java.util.Date;
import java.util.List;
import java.util.Optional;

import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialSecret;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialSecretStore;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.entity.users.UserMailAccount;
import com.iwhalecloud.byai.manager.vo.users.MailProviderVO;

/** Resolves mail credentials only while producing the private byCLI projection. */
@Service
public class MailCredentialResolver {
    private final ConnectorCredentialSecretStore secretStore;
    private final MailConnectorLookup connectorLookup;

    public MailCredentialResolver(
            ConnectorCredentialSecretStore secretStore, MailConnectorLookup connectorLookup) {
        this.secretStore = secretStore;
        this.connectorLookup = connectorLookup;
    }

    public Optional<ResolvedAuth> resolve(UserMailAccount account) {
        if (account == null || account.getUserId() == null || !"0".equals(account.getDeleteFlag())) {
            return Optional.empty();
        }
        MailProviderVO catalogProvider;
        try {
            catalogProvider = MailProviderCatalog.resolve(account.getProviderCode());
        } catch (RuntimeException e) {
            return Optional.empty();
        }
        String type = account.getAuthType();
        if (!catalogProvider.getAuthType().equals(type)) return Optional.empty();
        if ("APP_PASSWORD".equals(type) || "API_TOKEN".equals(type)) {
            if (!StringUtils.hasText(account.getAuthCodeCipher())) {
                return Optional.empty();
            }
            try {
                String secret = Sm4Util.decrypt(account.getAuthCodeCipher());
                return StringUtils.hasText(secret)
                    ? Optional.of(ResolvedAuth.secret(type, account.getEmail(), secret)) : Optional.empty();
            } catch (RuntimeException e) {
                throw new MailCredentialResolutionException(
                    MailCredentialResolutionException.Code.CORRUPT_CREDENTIAL, e);
            }
        }
        if (!"OAUTH2".equals(type) || !StringUtils.hasText(account.getCredentialRef())) {
            return Optional.empty();
        }
        MailProviderVO provider = catalogProvider;
        if (!StringUtils.hasText(provider.getConnectorCode())) {
            return Optional.empty();
        }
        ConnectorInfo connector;
        try {
            connector = connectorLookup.findActiveConnector(provider.getConnectorCode());
        } catch (RuntimeException e) {
            throw new MailCredentialResolutionException(
                MailCredentialResolutionException.Code.INFRASTRUCTURE, e);
        }
        if (connector == null || connector.getConnectorId() == null || !StringUtils.hasText(connector.getProviderCode())) {
            return Optional.empty();
        }
        ConnectorCredentialSecret secret;
        try {
            secret = secretStore.findActiveByReference(account.getCredentialRef(), account.getUserId().toString())
                .orElse(null);
        } catch (RuntimeException e) {
            throw new MailCredentialResolutionException(
                MailCredentialResolutionException.Code.INFRASTRUCTURE, e);
        }
        if (secret == null || !connector.getConnectorId().equals(secret.connectorId())
                || !connector.getProviderCode().equals(secret.providerCode())
                || !StringUtils.hasText(secret.accessToken()) || expired(secret.accessExpiresAt())) {
            return Optional.empty();
        }
        return Optional.of(ResolvedAuth.oauth(secret.accessToken(), secret.tokenType(), scopes(secret.grantedScopes()),
            secret.accessExpiresAt()));
    }

    private boolean expired(Date date) {
        return date != null && !date.after(new Date());
    }

    private List<String> scopes(String value) {
        return StringUtils.hasText(value) ? Arrays.stream(value.split("[,\\s]+"))
            .filter(StringUtils::hasText).distinct().sorted().toList() : List.of();
    }

    public record ResolvedAuth(String type, String username, String secret, String accessToken,
        String tokenType, List<String> scopes, Date accessExpiresAt, String refreshToken,
        String credentialReference) {
        static ResolvedAuth secret(String type, String username, String secret) {
            return new ResolvedAuth(type, username, secret, null, null, List.of(), null, null, null);
        }

        static ResolvedAuth oauth(String token, String tokenType, List<String> scopes, Date expiresAt) {
            return new ResolvedAuth("OAUTH2", null, null, token, tokenType, scopes, expiresAt, null, null);
        }


    }
}
