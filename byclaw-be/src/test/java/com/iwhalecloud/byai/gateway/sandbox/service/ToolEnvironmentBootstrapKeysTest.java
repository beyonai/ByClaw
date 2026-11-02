package com.iwhalecloud.byai.gateway.sandbox.service;

import static org.junit.jupiter.api.Assertions.*;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ToolEnvironmentBootstrapKeysTest {
    @Test void optionalBootstrapDoesNotChangeExistingLaunch() {
        assertEquals(Map.of(), ToolEnvironmentBootstrapKeys.parse(null));
    }

    @Test void acceptsOnlyTheTwoBoundedRequestScopedKeys() {
        String host = Base64.getEncoder().encodeToString(
            "-----BEGIN OPENSSH PRIVATE KEY-----\nfixture\n-----END OPENSSH PRIVATE KEY-----\n".getBytes(StandardCharsets.UTF_8));
        Map<String, String> keys = Map.of("authorizedKey", "ssh-ed25519 Zml4dHVyZQ== fixture",
            "hostPrivateKeyBase64", host);
        assertEquals(keys, ToolEnvironmentBootstrapKeys.parse(keys));
    }

    @Test void rejectsIncompleteOversizedAndEnvironmentInjectionWithoutEchoingSecrets() {
        for (Object value : new Object[]{Map.of("authorizedKey", "secret-fixture"),
            Map.of("authorizedKey", "ssh-ed25519 Zml4dHVyZQ==\ncommand=evil", "hostPrivateKeyBase64", "invalid"),
            Map.of("authorizedKey", "x".repeat(20000), "hostPrivateKeyBase64", "invalid"),
            Map.of("authorizedKey", "secret-fixture", "hostPrivateKeyBase64", "invalid", "REDIS_PASSWORD", "evil")}) {
            var error = assertThrows(IllegalArgumentException.class, () -> ToolEnvironmentBootstrapKeys.parse(value));
            assertFalse(error.getMessage().contains("secret-fixture"));
        }
    }
}
