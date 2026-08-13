package com.iwhalecloud.byai.manager.domain.usermcp;

import java.util.Base64;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class McpCredentialEnvelopeServiceTest {

    private final McpCredentialEnvelopeService service = new McpCredentialEnvelopeService(
        Base64.getEncoder().encodeToString(new byte[32]));

    @Test
    void sealsCredentialWithAuthenticatedContext() {
        String envelope = service.seal("secret-canary", "7:9:1:fingerprint");

        assertThat(envelope).doesNotContain("secret-canary");
        assertThat(service.open(envelope, "7:9:1:fingerprint")).isEqualTo("secret-canary");
        assertThatThrownBy(() -> service.open(envelope, "7:9:2:fingerprint"))
            .isInstanceOf(SecurityException.class);
    }

    @Test
    void refusesStaticCredentialsWithoutDeploymentKey() {
        McpCredentialEnvelopeService unconfigured = new McpCredentialEnvelopeService("");
        assertThatThrownBy(() -> unconfigured.seal("secret", "context"))
            .isInstanceOf(IllegalStateException.class);
    }
}
