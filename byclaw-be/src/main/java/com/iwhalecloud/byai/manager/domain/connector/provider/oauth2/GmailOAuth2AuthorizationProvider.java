package com.iwhalecloud.byai.manager.domain.connector.provider.oauth2;

import java.util.Map;
import java.util.Set;

import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialSecretStore;

@Component
public class GmailOAuth2AuthorizationProvider extends AbstractMailOAuth2AuthorizationProvider {
    public GmailOAuth2AuthorizationProvider(MailOAuth2Client client, ConnectorCredentialSecretStore secretStore,
            ObjectMapper objectMapper, OAuth2ClientSecretResolver secretResolver) {
        super(client, secretStore, objectMapper, secretResolver);
    }

    @Override public String providerCode() { return "gmail-oauth2"; }
    @Override protected MailOAuth2Client.Provider mailProvider() { return MailOAuth2Client.Provider.GMAIL; }
    @Override protected String authorizeUrl() { return "https://accounts.google.com/o/oauth2/v2/auth"; }
    @Override protected String displayName() { return "Gmail"; }
    @Override protected Set<String> requiredAccessTokenScopes() {
        return Set.of("https://www.googleapis.com/auth/gmail.modify");
    }
    @Override protected boolean requiresRefreshToken() { return true; }
    @Override protected Map<String, String> additionalAuthorizeParameters() {
        return Map.of("access_type", "offline", "prompt", "consent");
    }
}
