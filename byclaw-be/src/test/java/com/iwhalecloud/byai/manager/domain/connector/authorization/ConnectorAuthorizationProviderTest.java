package com.iwhalecloud.byai.manager.domain.connector.authorization;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class ConnectorAuthorizationProviderTest {

    @Test
    void rejectsCallbackWhenProviderDoesNotOptInToOAuth2CallbackHandling() {
        ConnectorAuthorizationProvider provider = new ConnectorAuthorizationProvider() {
            @Override
            public String providerCode() {
                return "test";
            }

            @Override
            public AuthorizationStartResult start(AuthorizationStartContext context) {
                return null;
            }

            @Override
            public AuthorizationStatusResult queryStatus(AuthorizationSessionContext session) {
                return null;
            }
        };

        assertThatThrownBy(() -> provider.handleCallback(null, null))
            .isInstanceOf(UnsupportedOperationException.class)
            .hasMessage("callback is not supported");
    }
}
