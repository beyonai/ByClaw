package com.iwhalecloud.byai.gateway.sandbox.spec;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/** Validates the public catalog metadata without exposing or rewriting execution credentials. */
public final class ToolSandboxMetadata {
    private ToolSandboxMetadata() {}

    public static String validationError(String source) {
        try {
            ObjectMapper json = new ObjectMapper();
            JsonNode spec = json.readTree(source);
            if (spec == null || !spec.isObject()) return "specJson must be a JSON object";
            JsonNode tool = spec.path("runtimeOptions").path("toolSandbox");
            if (tool.isMissingNode()) return null;
            if (!tool.isObject() || !"byclaw.tool-sandbox/v1".equals(tool.path("contract").asText()))
                return "Invalid tool sandbox contract";
            java.util.Iterator<JsonNode> values = tool.elements();
            while (values.hasNext()) {
                if (values.next().isContainerNode()) return "Tool metadata values must be scalar strings";
            }
            if (tool.has("enabled") && tool.get("enabled").isNull()) return "Invalid tool template enabled value";
            String enabled = tool.path("enabled").asText("true");
            if (!"true".equalsIgnoreCase(enabled) && !"false".equalsIgnoreCase(enabled)
                    && !"1".equals(enabled) && !"0".equals(enabled)) return "Invalid tool template enabled value";
            String purpose = tool.path("purpose").asText("");
            if (!purpose.isEmpty() && !purpose.matches("[a-z][a-z0-9-]{0,48}")) return "Invalid tool template purpose";
            if (tool.path("description").asText("").length() > 20000) return "Template description is too long";
            String cover = tool.path("coverImage").asText("");
            if (cover.length() > 750000 || (!cover.isEmpty()
                    && !cover.matches("(?is)^(https?://[^\\s]+|/[^/][^\\s]*|data:image/(png|jpeg|webp);base64,[a-z0-9+/=]+)$")))
                return "Invalid template cover image";
            JsonNode capabilities = tool.path("capabilities");
            if (!capabilities.isMissingNode()) {
                // Provider runtime options are string maps, so arrays are encoded as JSON strings.
                if (!capabilities.isTextual()) return "Capabilities must be a JSON array encoded as a string";
                capabilities = json.readTree(capabilities.asText());
                if (capabilities == null || !capabilities.isArray() || capabilities.size() > 64)
                    return "Invalid template capabilities";
                for (JsonNode capability : capabilities) {
                    if (!capability.isTextual() || !capability.asText().matches("[a-z][a-z0-9_.-]{0,80}"))
                        return "Invalid template capability";
                }
            }
            return null;
        } catch (Exception invalid) {
            return "Invalid sandbox configuration JSON";
        }
    }
}
