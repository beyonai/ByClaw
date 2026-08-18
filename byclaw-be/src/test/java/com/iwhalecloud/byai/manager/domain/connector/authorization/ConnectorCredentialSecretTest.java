package com.iwhalecloud.byai.manager.domain.connector.authorization;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class ConnectorCredentialSecretTest {

    @Test
    void keepsOAuthTokensOutOfCredentialReference() {
        ConnectorCredentialSecret secret = ConnectorCredentialSecret.forOAuth2(
            "github-oauth2", "1001", 1003L, "access-token", "refresh-token"
        );

        assertThat(secret.credentialReference()).doesNotContain("access-token", "refresh-token");
        assertThat(secret.accessToken()).isEqualTo("access-token");
        assertThat(secret.refreshToken()).isEqualTo("refresh-token");
    }
}
