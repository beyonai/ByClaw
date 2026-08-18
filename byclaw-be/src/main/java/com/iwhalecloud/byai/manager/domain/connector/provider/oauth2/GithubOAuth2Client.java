package com.iwhalecloud.byai.manager.domain.connector.provider.oauth2;

import java.util.Date;

public interface GithubOAuth2Client {
    Token exchange(ExchangeRequest request);

    User loadUser(String accessToken);

    void revoke(RevokeRequest request);

    record ExchangeRequest(String clientId, String clientSecret, String code, String redirectUri,
                           String codeVerifier) {
    }

    record Token(String accessToken, String refreshToken, String tokenType, String scopes,
                 Date accessExpiresAt, Date refreshExpiresAt) {
    }

    record User(String id, String login) {
    }

    record RevokeRequest(String clientId, String clientSecret, String accessToken) {
    }
}
