package com.iwhalecloud.byai.manager.domain.connector.authorization;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ConnectorCredentialFormProviderRegistryTest {

    @Test
    void verificationNormalizesNullEnvironmentAndIsImmutable() {
        CredentialFormVerification empty = new CredentialFormVerification(null, null);
        assertThat(empty.runtimeEnvironment()).isEmpty();
        Map<String, String> source = new java.util.HashMap<>(Map.of("key", "value"));
        CredentialFormVerification verification = new CredentialFormVerification(null, source);
        source.put("other", "value");
        assertThat(verification.runtimeEnvironment()).containsExactlyEntriesOf(Map.of("key", "value"));
        assertThatThrownBy(() -> verification.runtimeEnvironment().put("x", "y"))
            .isInstanceOf(UnsupportedOperationException.class);
    }

    @Test
    void registryRejectsBlankDuplicateAndUnknownCodes() {
        assertThatThrownBy(() -> new ConnectorCredentialFormProviderRegistry(List.of(provider(""))))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new ConnectorCredentialFormProviderRegistry(List.of(provider("ima"), provider("ima"))))
            .isInstanceOf(IllegalStateException.class);
        ConnectorCredentialFormProviderRegistry registry = new ConnectorCredentialFormProviderRegistry(List.of(provider("ima")));
        assertThatThrownBy(() -> registry.get("unknown"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("unknown");
    }

    private ConnectorCredentialFormProvider provider(String code) {
        return new ConnectorCredentialFormProvider() {
            @Override
            public String providerCode() {
                return code;
            }

            @Override
            public CredentialFormVerification verify(String userId, ConnectorInfo connector, Map<String, String> credentials) {
                return null;
            }
        };
    }
}
