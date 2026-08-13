package com.iwhalecloud.byai.manager.domain.usermcp;

import java.util.Map;
import java.util.Objects;

import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import com.iwhalecloud.byai.manager.dto.connector.McpCredentialInput;

@Component
public class UserMcpCredentialHeaders {

    public Map<String, String> from(UserMcpPublicConfig config, McpCredentialInput credential) {
        if (config.authProfile().mode() == UserMcpAuthMode.NONE) {
            return Map.of();
        }
        if (credential == null || !StringUtils.hasText(credential.value())
                || !Objects.equals(config.authProfile().credentialType(), credential.type())) {
            throw new IllegalArgumentException("Matching MCP credential is required");
        }
        return fromValue(credential.type(), credential.value());
    }

    public Map<String, String> fromValue(String type, String value) {
        return switch (type) {
            case "BEARER_TOKEN" -> Map.of("Authorization", "Bearer " + value);
            case "API_KEY" -> Map.of("X-API-Key", value);
            case "COOKIE" -> Map.of("Cookie", value);
            default -> throw new IllegalArgumentException("Unsupported MCP credential type");
        };
    }
}
