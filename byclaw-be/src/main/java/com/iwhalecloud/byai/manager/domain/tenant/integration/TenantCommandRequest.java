package com.iwhalecloud.byai.manager.domain.tenant.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Set;
import java.util.TreeSet;

/**
 * Validated immutable business snapshot; transport authentication is deliberately outside its digest.
 * An omitted profile remains unresolved until new-command acceptance freezes the startup default.
 */
public record TenantCommandRequest(String sourceSystem, String requestId, long ownerUserId,
                                  String enterpriseName, String profileKey, String tenantMode, String snapshot, String hash) {
    private static final ObjectMapper JSON = new ObjectMapper();

    public static TenantCommandRequest parse(JsonNode body) {
        fields(body, Set.of("sourceSystem", "requestId", "ownerUserId", "enterpriseName", "tenantMode", "actor", "reason", "resourceSpec", "initialPolicy"));
        String source = text(body, "sourceSystem", 64);
        String request = text(body, "requestId", 128);
        if (!source.matches("[a-zA-Z0-9_-]+") || !request.matches("[a-zA-Z0-9_.:-]{8,128}")) invalid();
        long owner = decimal(body.get("ownerUserId"));
        String name = text(body, "enterpriseName", 200);
        String tenantMode = body.has("tenantMode") ? text(body, "tenantMode", 32) : "STANDARD";
        if (!Set.of("STANDARD", "TRIAL").contains(tenantMode)) invalid();
        text(body,"reason",500);
        fields(body.get("actor"), Set.of("type", "id"));
        text(body.get("actor"),"type",64);
        text(body.get("actor"),"id",128);
        String profile = null;
        if (body.has("resourceSpec")) {
            JsonNode spec = body.get("resourceSpec");
            fields(spec, Set.of("profileKey", "bindingVersion"));
            if (spec.has("profileKey")) {
                profile = text(spec,"profileKey",10);
                if (!Set.of("s","m","l").contains(profile)) invalid();
            }
            // Older immutable requests retain their version field; new callers need only a profile key.
            if (spec.has("bindingVersion") && decimal(spec.get("bindingVersion")) != 1) {
                throw new TenantCommandException(409,"RESOURCE_BINDING_UNSUPPORTED");
            }
        }
        JsonNode policy = body.get("initialPolicy");
        if (policy == null || !policy.isObject() || !"PREPARED".equals(policy.path("accessMode").asText())
            || !"1".equals(policy.path("revision").asText()) || !policy.path("revision").isTextual()) invalid();
        // Keep omitted fields omitted so a later startup default cannot change a retry's business digest.
        String snapshot = canonical(body);
        return new TenantCommandRequest(source,request,owner,name,profile,tenantMode,snapshot,digest(snapshot));
    }

    public static long decimal(JsonNode value) {
        if (value == null || !value.isTextual() || !value.asText().matches("[1-9][0-9]{0,18}")) invalid();
        try { return Long.parseLong(value.asText()); }
        catch (NumberFormatException e) { throw new TenantCommandException(400,"INVALID_IDENTIFIER"); }
    }

    public static String text(JsonNode body, String key, int maximum) {
        JsonNode value = body == null ? null : body.get(key);
        if (value == null || !value.isTextual() || value.asText().isBlank()
            || value.asText().length() > maximum || !value.asText().equals(value.asText().trim())) invalid();
        return value.asText();
    }

    public static void fields(JsonNode body, Set<String> allowed) {
        if (body == null || !body.isObject()) invalid();
        body.fieldNames().forEachRemaining(key -> { if (!allowed.contains(key)) invalid(); });
    }

    public static String canonical(JsonNode value) {
        try { return JSON.writeValueAsString(sorted(value)); }
        catch (Exception e) { throw new TenantCommandException(400,"INVALID_REQUEST"); }
    }
    private static JsonNode sorted(JsonNode value) {
        if (value.isObject()) {
            ObjectNode result = JSON.createObjectNode();
            TreeSet<String> keys = new TreeSet<>();
            value.fieldNames().forEachRemaining(keys::add);
            keys.forEach(key -> result.set(key, sorted(value.get(key))));
            return result;
        }
        if (value.isArray()) {
            var result = JSON.createArrayNode();
            value.forEach(item -> result.add(sorted(item)));
            return result;
        }
        return value;
    }
    public static String digest(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (Exception e) { throw new IllegalStateException("SHA-256 unavailable",e); }
    }
    private static void invalid() { throw new TenantCommandException(400,"INVALID_REQUEST"); }
}
