package com.iwhalecloud.byai.gateway.sandbox.support;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * Backward-compatible codec for ss_sandbox_record.endpoint.
 * Supports both legacy plain endpoint strings and the new JSON object format:
 * {"openclaw":"https://...","service-a":"https://..."}.
 */
public final class SandboxEndpointRecordSupport {

    public static final String OPENCLAW_INSTANCE = "openclaw";

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();
    private static final TypeReference<LinkedHashMap<String, String>> STRING_MAP_TYPE = new TypeReference<>() {
    };

    private SandboxEndpointRecordSupport() {
    }

    public static Map<String, String> parseInstanceEndpoints(String endpointField) {
        String value = StringUtils.trimToNull(endpointField);
        if (value == null) {
            return Collections.emptyMap();
        }
        if (!looksLikeJsonObject(value)) {
            return Collections.singletonMap(OPENCLAW_INSTANCE, value);
        }
        try {
            Map<String, String> parsed = OBJECT_MAPPER.readValue(value, STRING_MAP_TYPE);
            LinkedHashMap<String, String> normalized = normalizeInstanceEndpoints(parsed);
            if (!normalized.isEmpty()) {
                return normalized;
            }
            return Collections.emptyMap();
        }
        catch (Exception e) {
            return Collections.singletonMap(OPENCLAW_INSTANCE, value);
        }
    }

    public static LinkedHashMap<String, String> normalizeInstanceEndpoints(Map<String, String> instanceEndpoints) {
        LinkedHashMap<String, String> normalized = new LinkedHashMap<>();
        if (instanceEndpoints == null || instanceEndpoints.isEmpty()) {
            return normalized;
        }
        String openclawEndpoint = StringUtils.trimToNull(instanceEndpoints.get(OPENCLAW_INSTANCE));
        if (openclawEndpoint != null) {
            normalized.put(OPENCLAW_INSTANCE, openclawEndpoint);
        }
        instanceEndpoints.forEach((instance, endpoint) -> {
            String key = StringUtils.trimToNull(instance);
            String value = StringUtils.trimToNull(endpoint);
            if (key == null || value == null || normalized.containsKey(key)) {
                return;
            }
            normalized.put(key, value);
        });
        return normalized;
    }

    public static String toStorageValue(Map<String, String> instanceEndpoints, String fallbackEndpoint) {
        LinkedHashMap<String, String> normalized = normalizeInstanceEndpoints(instanceEndpoints);
        if (!normalized.isEmpty()) {
            try {
                return OBJECT_MAPPER.writeValueAsString(normalized);
            }
            catch (Exception e) {
                String primary = resolvePrimaryEndpoint(normalized);
                return StringUtils.defaultIfBlank(primary, StringUtils.trimToNull(fallbackEndpoint));
            }
        }
        return StringUtils.trimToNull(fallbackEndpoint);
    }

    public static String resolvePrimaryEndpoint(String endpointField) {
        return resolvePrimaryEndpoint(parseInstanceEndpoints(endpointField));
    }

    public static String resolvePrimaryEndpoint(Map<String, String> instanceEndpoints) {
        if (instanceEndpoints == null || instanceEndpoints.isEmpty()) {
            return null;
        }
        String openclawEndpoint = StringUtils.trimToNull(instanceEndpoints.get(OPENCLAW_INSTANCE));
        if (openclawEndpoint != null) {
            return openclawEndpoint;
        }
        for (String endpoint : instanceEndpoints.values()) {
            String value = StringUtils.trimToNull(endpoint);
            if (value != null) {
                return value;
            }
        }
        return null;
    }

    public static String resolveInstanceEndpoint(String endpointField, String instance) {
        return resolveInstanceEndpoint(parseInstanceEndpoints(endpointField), instance);
    }

    public static String resolveInstanceEndpoint(Map<String, String> instanceEndpoints, String instance) {
        if (instanceEndpoints == null || instanceEndpoints.isEmpty()) {
            return null;
        }
        String key = StringUtils.trimToNull(instance);
        if (key == null) {
            return resolvePrimaryEndpoint(instanceEndpoints);
        }
        String endpoint = StringUtils.trimToNull(instanceEndpoints.get(key));
        return endpoint != null ? endpoint : resolvePrimaryEndpoint(instanceEndpoints);
    }

    private static boolean looksLikeJsonObject(String value) {
        return value.startsWith("{") && value.endsWith("}");
    }
}
