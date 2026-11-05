package com.iwhalecloud.byai.manager.domain.connector.authorization;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/** Public result of the latest permission request; never contains CLI credentials or raw output. */
public record ConnectorPermissionSummary(String permissionStatus, List<String> missingScopes) {
    private static final int MAX_SCOPES_JSON_LENGTH = 64 * 1024;
    private static final int MAX_SCOPE_COUNT = 1024;
    private static final Pattern SCOPE = Pattern.compile("[A-Za-z][A-Za-z0-9._:-]{0,255}");
    private static final Set<String> STATUSES = Set.of("complete", "partial", "unknown");

    public static ConnectorPermissionSummary absent() {
        return new ConnectorPermissionSummary(null, List.of());
    }

    public static ConnectorPermissionSummary unknown() {
        return new ConnectorPermissionSummary("unknown", List.of());
    }

    public static ConnectorPermissionSummary fromAttributes(Map<?, ?> attributes) {
        if (attributes == null || (!attributes.containsKey("permissionStatus") && !attributes.containsKey("missingScopes"))) {
            return absent();
        }
        if (!(attributes.get("permissionStatus") instanceof String status) || !STATUSES.contains(status)) {
            return unknown();
        }
        Object raw = attributes.get("missingScopes");
        if (!(raw instanceof String json) || json.length() > MAX_SCOPES_JSON_LENGTH) {
            return unknown();
        }
        try {
            JSONArray array = JSON.parseArray(json);
            if (array == null || array.size() > MAX_SCOPE_COUNT) {
                return unknown();
            }
            Set<String> scopes = new LinkedHashSet<>();
            for (Object value : array) {
                if (!(value instanceof String scope) || !SCOPE.matcher(scope).matches()) {
                    return unknown();
                }
                scopes.add(scope);
            }
            if ("partial".equals(status) != !scopes.isEmpty()) {
                return unknown();
            }
            return new ConnectorPermissionSummary(status, List.copyOf(scopes));
        } catch (RuntimeException ignored) {
            return unknown();
        }
    }

    /** A verification-only sync must not erase the latest authorization request result. */
    public static Map<String, String> retainedAttributes(
            Map<?, ?> previous, String providerCode, AuthorizationStatusResult current) {
        if (previous == null || current == null || current.accountAttributes().containsKey("permissionStatus")
                || !previous.containsKey("permissionStatus")
                || !java.util.Objects.equals(providerCode, previous.get("providerCode"))
                || current.accountId() == null || current.accountId().isBlank()
                || !java.util.Objects.equals(current.credentialReference(), previous.get("credentialReference"))
                || !java.util.Objects.equals(current.accountId(), previous.get("accountId"))) {
            return Map.of();
        }
        return fromAttributes(previous).accountAttributes();
    }

    public Map<String, String> accountAttributes() {
        if (permissionStatus == null) {
            return Map.of();
        }
        return Map.of("permissionStatus", permissionStatus, "missingScopes", JSON.toJSONString(missingScopes));
    }
}
