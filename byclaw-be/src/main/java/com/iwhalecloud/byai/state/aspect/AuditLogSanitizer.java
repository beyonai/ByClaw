package com.iwhalecloud.byai.state.aspect;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import java.util.Locale;
import java.util.Set;

/** Redact credentials from detached audit JSON without changing API requests or responses. */
final class AuditLogSanitizer {
    private static final String MASK = "[REDACTED]";
    private static final Set<String> SECRETS = Set.of("apitoken", "apikey", "authtoken", "accesstoken",
        "refreshtoken", "token", "password", "pwd", "accountpwd", "authorization", "beyondtoken", "ssotoken",
        "secret", "secretkey", "clientsecret", "accesskey", "xapikey", "xapiaccesskey", "xapiappkey",
        "xapiappsecret");

    private AuditLogSanitizer() {
    }

    static String serialize(Object value) {
        return JSON.toJSONString(redact(JSON.parse(JSON.toJSONString(value)), 0));
    }

    private static Object redact(Object value, int depth) {
        if (depth > 32) return MASK;
        if (value instanceof JSONObject object) {
            String headerName = object.getString("key");
            if (headerName == null) headerName = object.getString("name");
            boolean secretHeader = sensitive(headerName);
            for (String key : Set.copyOf(object.keySet())) {
                if (sensitive(key) || (secretHeader && "value".equalsIgnoreCase(key))) {
                    object.put(key, MASK);
                } else {
                    object.put(key, redact(object.get(key), depth + 1));
                }
            }
        } else if (value instanceof JSONArray array) {
            for (int i = 0; i < array.size(); i++) array.set(i, redact(array.get(i), depth + 1));
        } else if (value instanceof String text) {
            String trimmed = text.trim();
            if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
                try {
                    return JSON.toJSONString(redact(JSON.parse(trimmed), depth + 1));
                } catch (RuntimeException ignored) {
                    // Ordinary free text can start with braces without being JSON.
                }
            }
        }
        return value;
    }

    private static boolean sensitive(String key) {
        return key != null && SECRETS.contains(key.replaceAll("[-_]", "").toLowerCase(Locale.ROOT));
    }
}
