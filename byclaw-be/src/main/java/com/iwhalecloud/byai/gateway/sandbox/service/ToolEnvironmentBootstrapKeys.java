package com.iwhalecloud.byai.gateway.sandbox.service;

import java.util.Map;

/** Request-scoped SSH bootstrap; never stored in user private parameters. */
public final class ToolEnvironmentBootstrapKeys {
    private ToolEnvironmentBootstrapKeys() { }

    public static Map<String, String> parse(Object value) {
        if (value == null) return Map.of();
        if (!(value instanceof Map<?, ?> keys) || keys.size() != 2
            || !(keys.get("authorizedKey") instanceof String authorized)
            || !(keys.get("hostPrivateKeyBase64") instanceof String encoded)
            || authorized.length() > 8192 || encoded.length() > 16384
            || !authorized.matches("ssh-ed25519 [A-Za-z0-9+/]+={0,2}(?: [A-Za-z0-9@._-]+)?")) {
            throw new IllegalArgumentException("Invalid request-scoped tool SSH bootstrap");
        }
        String host;
        try {
            host = new String(java.util.Base64.getDecoder().decode(encoded), java.nio.charset.StandardCharsets.UTF_8);
        } catch (IllegalArgumentException invalid) {
            throw new IllegalArgumentException("Invalid request-scoped tool SSH bootstrap");
        }
        if (!host.startsWith("-----BEGIN OPENSSH PRIVATE KEY-----\n")
            || !host.stripTrailing().endsWith("-----END OPENSSH PRIVATE KEY-----")) {
            throw new IllegalArgumentException("Invalid request-scoped tool SSH bootstrap");
        }
        return Map.of("authorizedKey", authorized, "hostPrivateKeyBase64", encoded);
    }
}
