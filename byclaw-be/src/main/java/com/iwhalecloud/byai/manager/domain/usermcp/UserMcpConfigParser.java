package com.iwhalecloud.byai.manager.domain.usermcp;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.usermcp.UserMcpPublicConfig.AuthProfile;
import com.iwhalecloud.byai.manager.domain.usermcp.UserMcpPublicConfig.Transport;

@Component
public class UserMcpConfigParser {

    private static final Set<String> ROOT_FIELDS = Set.of("domainURL", "metaContent", "timeoutSeconds");
    private static final Set<String> META_FIELDS = Set.of("mcpType", "mcpServerUrl", "authProfile");
    private static final Set<String> AUTH_FIELDS = Set.of("mode", "credentialType");
    private static final Set<String> STATIC_CREDENTIAL_TYPES = Set.of("BEARER_TOKEN", "API_KEY", "COOKIE");
    private static final int DEFAULT_TIMEOUT_SECONDS = 20;

    private final ObjectMapper objectMapper;
    private final McpEndpointPolicy endpointPolicy;

    public UserMcpConfigParser(ObjectMapper objectMapper, McpEndpointPolicy endpointPolicy) {
        this.objectMapper = objectMapper;
        this.endpointPolicy = endpointPolicy;
    }

    public UserMcpPublicConfig parse(String sourceContent) {
        JsonNode root = readObject(sourceContent, "MCP config");
        requireOnly(root, ROOT_FIELDS, "MCP config");
        JsonNode meta = requireObject(root, "metaContent");
        requireOnly(meta, META_FIELDS, "metaContent");
        JsonNode auth = requireObject(meta, "authProfile");
        requireOnly(auth, AUTH_FIELDS, "authProfile");

        String domainUrl = requireText(root, "domainURL");
        Transport transport = Transport.fromJson(requireText(meta, "mcpType"));
        if (transport != Transport.STREAMABLE_HTTP) {
            throw new IllegalArgumentException("SSE is disabled until its dynamic endpoint can be pinned safely");
        }
        String serverPath = requireText(meta, "mcpServerUrl");
        UserMcpAuthMode authMode = parseAuthMode(requireText(auth, "mode"));
        String credentialType = optionalText(auth, "credentialType");
        validateCredentialType(authMode, credentialType);
        int timeoutSeconds = parseTimeout(root.get("timeoutSeconds"));
        URI endpoint = endpointPolicy.validate(domainUrl, serverPath);
        String origin = endpoint.getScheme() + "://" + endpoint.getHost()
            + (endpoint.getPort() < 0 ? "" : ":" + endpoint.getPort());
        String canonicalPath = endpoint.getRawPath();
        AuthProfile profile = new AuthProfile(authMode, credentialType);
        String fingerprint = sha256(transport.jsonValue() + "|" + endpoint + "|" + authMode + "|"
            + (credentialType == null ? "" : credentialType));
        return new UserMcpPublicConfig(origin, transport, canonicalPath, endpoint, profile, timeoutSeconds, fingerprint);
    }

    public String toJson(UserMcpPublicConfig config) {
        Map<String, Object> authProfile = new LinkedHashMap<>();
        authProfile.put("mode", config.authProfile().mode().name());
        if (config.authProfile().credentialType() != null) {
            authProfile.put("credentialType", config.authProfile().credentialType());
        }
        Map<String, Object> metaContent = new LinkedHashMap<>();
        metaContent.put("mcpType", config.transport().jsonValue());
        metaContent.put("mcpServerUrl", config.serverPath());
        metaContent.put("authProfile", authProfile);
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("domainURL", config.domainUrl());
        root.put("metaContent", metaContent);
        root.put("timeoutSeconds", config.timeoutSeconds());
        try {
            return objectMapper.writeValueAsString(root);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Could not serialize canonical MCP config", e);
        }
    }

    private JsonNode readObject(String json, String label) {
        if (!StringUtils.hasText(json)) {
            throw new IllegalArgumentException(label + " is required");
        }
        try {
            JsonNode node = objectMapper.readTree(json);
            if (node == null || !node.isObject()) {
                throw new IllegalArgumentException(label + " must be an object");
            }
            return node;
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException(label + " is invalid JSON", e);
        }
    }

    private JsonNode requireObject(JsonNode parent, String field) {
        JsonNode node = parent.get(field);
        if (node == null || !node.isObject()) {
            throw new IllegalArgumentException(field + " must be an object");
        }
        return node;
    }

    private String requireText(JsonNode parent, String field) {
        String value = optionalText(parent, field);
        if (!StringUtils.hasText(value)) {
            throw new IllegalArgumentException(field + " is required");
        }
        return value.trim();
    }

    private String optionalText(JsonNode parent, String field) {
        JsonNode node = parent.get(field);
        if (node == null || node.isNull()) {
            return null;
        }
        if (!node.isTextual()) {
            throw new IllegalArgumentException(field + " must be a string");
        }
        return node.asText().trim();
    }

    private void requireOnly(JsonNode node, Set<String> fields, String label) {
        Iterator<String> names = node.fieldNames();
        while (names.hasNext()) {
            String name = names.next();
            if (!fields.contains(name)) {
                throw new IllegalArgumentException("Unsupported field in " + label + ": " + name);
            }
        }
    }

    private UserMcpAuthMode parseAuthMode(String value) {
        try {
            return UserMcpAuthMode.valueOf(value.toUpperCase());
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("Unsupported MCP auth mode: " + value, e);
        }
    }

    private void validateCredentialType(UserMcpAuthMode mode, String credentialType) {
        if (mode == UserMcpAuthMode.NONE && StringUtils.hasText(credentialType)) {
            throw new IllegalArgumentException("NONE auth must not define credentialType");
        }
        if (mode == UserMcpAuthMode.STATIC_HEADER && !STATIC_CREDENTIAL_TYPES.contains(credentialType)) {
            throw new IllegalArgumentException("Unsupported static credential type");
        }
    }

    private int parseTimeout(JsonNode node) {
        if (node == null || node.isNull()) {
            return DEFAULT_TIMEOUT_SECONDS;
        }
        if (!node.canConvertToInt()) {
            throw new IllegalArgumentException("timeoutSeconds must be an integer");
        }
        int timeout = node.asInt();
        if (timeout < 1 || timeout > 60) {
            throw new IllegalArgumentException("timeoutSeconds must be between 1 and 60");
        }
        return timeout;
    }

    private String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
    }
}
