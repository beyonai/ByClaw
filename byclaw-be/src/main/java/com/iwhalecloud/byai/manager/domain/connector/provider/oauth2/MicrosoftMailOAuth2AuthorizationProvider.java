package com.iwhalecloud.byai.manager.domain.connector.provider.oauth2;

import java.util.Set;

import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialSecretStore;

@Component
public class MicrosoftMailOAuth2AuthorizationProvider extends AbstractMailOAuth2AuthorizationProvider {
    public MicrosoftMailOAuth2AuthorizationProvider(MailOAuth2Client client, ConnectorCredentialSecretStore secretStore,
            ObjectMapper objectMapper, OAuth2ClientSecretResolver secretResolver) {
        super(client, secretStore, objectMapper, secretResolver);
    }

    @Override public String providerCode() { return "microsoft-mail-oauth2"; }
    @Override protected MailOAuth2Client.Provider mailProvider() { return MailOAuth2Client.Provider.MICROSOFT; }
    @Override protected String authorizeUrl() {
        return "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
    }
    @Override protected String displayName() { return "Microsoft"; }
    @Override protected Set<String> nonAccessTokenScopes() {
        return Set.of("openid", "profile", "email", "offline_access");
    }
    @Override protected Set<String> requiredAccessTokenScopes() {
        return Set.of("User.Read", "Mail.ReadWrite", "Mail.Send");
    }
    @Override protected boolean requiresRefreshToken() { return true; }

    @Override
    protected void revokeRemote(String accessToken) {
        // Microsoft identity platform has no reliable endpoint that revokes one access/refresh token pair.
        // Removing the encrypted local credential is therefore the supported disconnect operation.
    }
}
