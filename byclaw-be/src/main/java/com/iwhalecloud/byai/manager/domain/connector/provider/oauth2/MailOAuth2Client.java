package com.iwhalecloud.byai.manager.domain.connector.provider.oauth2;

import java.util.Date;
import java.util.Map;

public interface MailOAuth2Client {
    Token exchange(ExchangeRequest request);

    Token refresh(RefreshRequest request);

    Profile loadProfile(Provider provider, String accessToken);

    void revoke(Provider provider, String accessToken);

    enum Provider { GMAIL, MICROSOFT }

    record ExchangeRequest(Provider provider, String clientId, String clientSecret, String code,
                           String redirectUri, String codeVerifier) { }

    record RefreshRequest(Provider provider, String clientId, String clientSecret, String refreshToken,
                          String scopes) { }

    record Token(String accessToken, String refreshToken, String tokenType, String scopes,
                 Date accessExpiresAt, Date refreshExpiresAt) { }

    record Profile(String accountId, String accountName, Map<String, String> accountAttributes) {
        public Profile {
            accountAttributes = accountAttributes == null ? Map.of() : Map.copyOf(accountAttributes);
        }
    }
}
