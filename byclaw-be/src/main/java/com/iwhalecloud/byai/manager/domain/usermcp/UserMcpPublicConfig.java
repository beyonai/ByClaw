package com.iwhalecloud.byai.manager.domain.usermcp;

import java.net.URI;

public record UserMcpPublicConfig(
    String domainUrl,
    Transport transport,
    String serverPath,
    URI endpoint,
    AuthProfile authProfile,
    int timeoutSeconds,
    String endpointFingerprint
) {
    public enum Transport {
        SSE("sse"),
        STREAMABLE_HTTP("streamable-http");

        private final String jsonValue;

        Transport(String jsonValue) {
            this.jsonValue = jsonValue;
        }

        public String jsonValue() {
            return jsonValue;
        }

        public static Transport fromJson(String value) {
            for (Transport transport : values()) {
                if (transport.jsonValue.equalsIgnoreCase(value)) {
                    return transport;
                }
            }
            throw new IllegalArgumentException("Unsupported MCP transport: " + value);
        }
    }

    public record AuthProfile(UserMcpAuthMode mode, String credentialType) {
    }
}
