package com.iwhalecloud.byai.manager.domain.connector.authorization;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;

import org.junit.jupiter.api.Test;

class AuthorizationProviderRegistryTest {

    @Test
    void returnsProviderByCode() {
        ConnectorAuthorizationProvider provider = provider("dingtalk");
        AuthorizationProviderRegistry registry = new AuthorizationProviderRegistry(List.of(provider));

        assertThat(registry.get("dingtalk")).isSameAs(provider);
    }

    @Test
    void unknownProviderThrowsExceptionContainingRequestedCode() {
        AuthorizationProviderRegistry registry = new AuthorizationProviderRegistry(List.of(provider("dingtalk")));

        assertThatThrownBy(() -> registry.get("missing"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("missing");
    }

    @Test
    void duplicateProviderCodesThrowIllegalStateException() {
        assertThatThrownBy(() -> new AuthorizationProviderRegistry(List.of(
            provider("dingtalk"), provider("dingtalk"))))
            .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void blankProviderCodesAreRejected() {
        assertThatThrownBy(() -> new AuthorizationProviderRegistry(List.of(provider(null))))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new AuthorizationProviderRegistry(List.of(provider(""))))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new AuthorizationProviderRegistry(List.of(provider("   "))))
            .isInstanceOf(IllegalArgumentException.class);
    }

    private ConnectorAuthorizationProvider provider(String code) {
        return new ConnectorAuthorizationProvider() {
            @Override
            public String providerCode() {
                return code;
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
    }
}
