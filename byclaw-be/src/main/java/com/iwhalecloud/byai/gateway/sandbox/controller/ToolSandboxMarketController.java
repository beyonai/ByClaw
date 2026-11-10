package com.iwhalecloud.byai.gateway.sandbox.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.gateway.sandbox.mapper.SandboxServiceSpecEntityMapper;
import com.iwhalecloud.byai.gateway.sandbox.persistence.SandboxServiceSpecEntity;
import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformRemoteGateway;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/** Authenticated, credential-free view of the admitted tool environment catalog. */
@RestController
@RequestMapping("/sandbox/toolTemplates")
public class ToolSandboxMarketController {
    private final SandboxServiceSpecEntityMapper specs;
    private final PlatformRemoteGateway platform;
    private final ObjectMapper json = new ObjectMapper();

    public ToolSandboxMarketController(SandboxServiceSpecEntityMapper specs, PlatformRemoteGateway platform) {
        this.specs = specs;
        this.platform = platform;
    }

    @PostMapping
    public ResponseUtil list() {
        return list(true);
    }

    /** Small execution catalog; no cover images, configuration or build-history requests. */
    @PostMapping("/catalog")
    public ResponseUtil catalog() {
        ResponseUtil response = list(false);
        if (response.getCode() != ResponseUtil.SUCCESS) return response;
        List<Map<String, Object>> result = new ArrayList<>();
        Set<Object> ambiguous = ambiguousKeys((List<?>) response.getData());
        for (Object value : (List<?>) response.getData()) {
            Map<?, ?> entry = (Map<?, ?>) value;
            if (!validKey(entry.get("templateKey")) || ambiguous.contains(entry.get("templateKey"))) continue;
            result.add(Map.of("templateKey", entry.get("templateKey"), "serviceKey", entry.get("serviceKey"),
                "capabilities", entry.get("capabilities"), "enabled", entry.get("enabled")));
        }
        return ResponseUtil.successResponse(result);
    }

    private ResponseUtil list(boolean includeBuildState) {
        String user = CurrentUserHolder.getCurrentUserCode();
        if (user == null || user.isBlank()) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        List<Map<String, Object>> result = new ArrayList<>();
        List<SandboxServiceSpecEntity> rows;
        if (platform.isRemote()) {
            ResponseUtil response = platform.controller("listServiceSpec", Map.of());
            if (response.getCode() != ResponseUtil.SUCCESS) return ResponseUtil.fail(response.getMsg());
            rows = remoteSpecs(response.getData());
        } else {
            rows = specs.selectList(null);
        }
        if (rows == null) rows = List.of();
        for (var row : rows) {
            if (row == null || !"USER".equals(row.getOwnerScope())) continue;
            String key = row.getServiceKey();
            try {
                JsonNode spec = json.readTree(row.getSpecJson());
                JsonNode metadata = spec.path("runtimeOptions").path("toolSandbox");
                if (!"byclaw.tool-sandbox/v1".equals(metadata.path("contract").asText())) continue;
                JsonNode capabilities = metadata.path("capabilities");
                if (capabilities.isTextual()) capabilities = json.readTree(capabilities.asText());
                List<String> names = new ArrayList<>();
                if (capabilities.isArray()) for (JsonNode capability : capabilities) {
                    if (capability.isTextual() && capability.asText().matches("[a-z][a-z0-9_.-]{0,80}")) names.add(capability.asText());
                }
                String state = "UNKNOWN";
                if (includeBuildState && platform.isRemote()) {
                    ResponseUtil response = platform.controller("templateRebuild/records",
                        Map.of("serviceKey", key, "pageNo", 1, "pageSize", 1));
                    if (ResponseUtil.SUCCESS == response.getCode()) {
                        JsonNode status = json.valueToTree(response.getData()).findValue("state");
                        if (status != null) state = status.asText();
                    }
                }
                Map<String, Object> view = new LinkedHashMap<>();
                view.put("templateKey", metadata.path("purpose").asText(key.startsWith("byclaw-tools-") ? key.substring("byclaw-tools-".length()) : key));
                view.put("serviceKey", key);
                view.put("displayName", row.getDisplayName() == null ? key : row.getDisplayName());
                view.put("imageTag", metadata.path("imageTag").asText());
                view.put("capabilities", names);
                view.put("description", metadata.path("description").asText());
                String cover = metadata.path("coverImage").asText();
                view.put("coverImage", cover.matches("(?is)^(https?://|/[^/]|data:image/(png|jpeg|webp);base64,).*") ? cover : "");
                String enabled = metadata.path("enabled").asText("true");
                view.put("enabled", Integer.valueOf(1).equals(row.getEnabled())
                    && ("true".equalsIgnoreCase(enabled) || "1".equals(enabled)));
                view.put("operations", Map.of("protocol", "ssh", "exposure", "private"));
                view.put("displayAvailable", false);
                view.put("buildStatus", state);
                view.put("ready", "SUCCEEDED".equals(state));
                result.add(view);
            } catch (Exception unavailable) {
                // Malformed or unreachable entries are not silently admitted.
            }
        }
        Set<Object> ambiguous = ambiguousKeys(result);
        for (Map<String, Object> entry : result) {
            entry.put("available", Boolean.TRUE.equals(entry.get("enabled"))
                && validKey(entry.get("templateKey")) && !ambiguous.contains(entry.get("templateKey")));
        }
        return ResponseUtil.successResponse(result);
    }

    private List<SandboxServiceSpecEntity> remoteSpecs(Object value) {
        JsonNode items = json.valueToTree(value);
        if (items == null || !items.isArray()) throw new IllegalStateException("Invalid remote service specification list");
        List<SandboxServiceSpecEntity> result = new ArrayList<>();
        for (JsonNode item : items) {
            if (item.isNull()) continue;
            if (!item.isObject()) throw new IllegalStateException("Invalid remote service specification entry");
            // Management responses may gain fields such as validationError. Copy only the
            // inputs this view needs; never relax the shared mapper or echo arbitrary fields.
            var selected = json.createObjectNode();
            for (String name : List.of("serviceKey", "ownerScope", "enabled", "specJson", "displayName")) {
                if (item.has(name)) selected.set(name, item.get(name));
            }
            result.add(json.convertValue(selected, SandboxServiceSpecEntity.class));
        }
        return result;
    }

    private static boolean validKey(Object value) {
        return value instanceof String && ((String) value).matches("[a-z][a-z0-9-]{0,48}");
    }

    private static Set<Object> ambiguousKeys(List<?> entries) {
        Set<Object> seen = new HashSet<>(), ambiguous = new HashSet<>();
        for (Object value : entries) {
            Object key = ((Map<?, ?>) value).get("templateKey");
            if (!seen.add(key)) ambiguous.add(key);
        }
        return ambiguous;
    }
}
