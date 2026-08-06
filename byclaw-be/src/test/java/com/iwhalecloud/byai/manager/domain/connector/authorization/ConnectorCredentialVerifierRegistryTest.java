package com.iwhalecloud.byai.manager.domain.connector.authorization;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;

import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;

class ConnectorCredentialVerifierRegistryTest {

    @Test
    void returnsVerifierByProviderCode() {
        ConnectorCredentialVerifier verifier = verifier("dws-dingtalk");
        ConnectorCredentialVerifierRegistry registry =
            new ConnectorCredentialVerifierRegistry(List.of(verifier));

        assertThat(registry.get("dws-dingtalk")).isSameAs(verifier);
    }

    @Test
    void unknownProviderThrowsExceptionContainingRequestedCode() {
        ConnectorCredentialVerifierRegistry registry =
            new ConnectorCredentialVerifierRegistry(List.of(verifier("dws-dingtalk")));

        assertThatThrownBy(() -> registry.get("missing"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("missing");
    }

    @Test
    void duplicateProviderCodesFailFast() {
        assertThatThrownBy(() -> new ConnectorCredentialVerifierRegistry(List.of(
            verifier("dws-dingtalk"), verifier("dws-dingtalk"))))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("dws-dingtalk");
    }

    @Test
    void blankProviderCodesAreRejected() {
        assertThatThrownBy(() -> new ConnectorCredentialVerifierRegistry(List.of(verifier(null))))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new ConnectorCredentialVerifierRegistry(List.of(verifier(""))))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new ConnectorCredentialVerifierRegistry(List.of(verifier("   "))))
            .isInstanceOf(IllegalArgumentException.class);
    }

    private ConnectorCredentialVerifier verifier(String providerCode) {
        return new ConnectorCredentialVerifier() {
            @Override
            public String providerCode() {
                return providerCode;
            }

            @Override
            public AuthorizationStatusResult verify(String userId, ConnectorInfo connector) {
                return null;
            }
        };
    }
}
