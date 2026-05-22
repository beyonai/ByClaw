package com.iwhalecloud.byai.gateway.sandbox.support;

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
    private static final int MAX_NESTED_ENDPOINT_DEPTH = 8;

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();
    private static final TypeReference<LinkedHashMap<String, String>> STRING_MAP_TYPE = new TypeReference<>() {
    };

    private SandboxEndpointRecordSupport() {
    }

    public static Map<String, String> parseInstanceEndpoints(String endpointField) {
        return parseEndpointRecord(endpointField).instanceEndpoints();
    }

    public static EndpointRecordParseResult parseEndpointRecord(String endpointField) {
        String value = StringUtils.trimToNull(endpointField);
        if (value == null) {
            return new EndpointRecordParseResult(null, new LinkedHashMap<>(), false);
        }
        if (!startsLikeJsonObject(value)) {
            LinkedHashMap<String, String> legacy = new LinkedHashMap<>();
            legacy.put(OPENCLAW_INSTANCE, value);
            return new EndpointRecordParseResult(value, legacy, false);
        }
        if (!looksLikeJsonObject(value)) {
            LinkedHashMap<String, String> malformed = new LinkedHashMap<>();
            malformed.put(OPENCLAW_INSTANCE, value);
            return new EndpointRecordParseResult(value, malformed, true);
        }
        try {
            Map<String, String> parsed = OBJECT_MAPPER.readValue(value, STRING_MAP_TYPE);
            NormalizeResult normalized = normalizeInstanceEndpointsInternal(parsed, MAX_NESTED_ENDPOINT_DEPTH);
            if (!normalized.isEmpty()) {
                return new EndpointRecordParseResult(value, normalized.instanceEndpoints(), normalized.malformedJson());
            }
            return new EndpointRecordParseResult(value, new LinkedHashMap<>(), normalized.malformedJson());
        }
        catch (Exception e) {
            LinkedHashMap<String, String> malformed = new LinkedHashMap<>();
            malformed.put(OPENCLAW_INSTANCE, value);
            return new EndpointRecordParseResult(value, malformed, true);
        }
    }

    public static LinkedHashMap<String, String> normalizeInstanceEndpoints(Map<String, String> instanceEndpoints) {
        return normalizeInstanceEndpointsInternal(instanceEndpoints, MAX_NESTED_ENDPOINT_DEPTH).instanceEndpoints();
    }

    private static NormalizeResult normalizeInstanceEndpointsInternal(Map<String, String> instanceEndpoints, int depth) {
        LinkedHashMap<String, String> normalized = new LinkedHashMap<>();
        if (instanceEndpoints == null || instanceEndpoints.isEmpty()) {
            return new NormalizeResult(normalized, false);
        }
        boolean malformedJson = putNormalizedEndpoint(normalized, OPENCLAW_INSTANCE,
            instanceEndpoints.get(OPENCLAW_INSTANCE), depth);
        instanceEndpoints.forEach((instance, endpoint) -> {
            String key = StringUtils.trimToNull(instance);
            if (key == null || normalized.containsKey(key)) {
                return;
            }
            EndpointValue endpointValue = normalizeEndpointValue(key, endpoint, depth);
            if (endpointValue.malformedJson()) {
                normalized.put(key, endpointValue.value());
            }
            else if (endpointValue.value() != null) {
                normalized.put(key, endpointValue.value());
            }
        });
        for (String endpoint : instanceEndpoints.values()) {
            EndpointValue endpointValue = normalizeEndpointValue(null, endpoint, depth);
            malformedJson = malformedJson || endpointValue.malformedJson();
        }
        return new NormalizeResult(normalized, malformedJson);
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

    private static boolean startsLikeJsonObject(String value) {
        return value.startsWith("{");
    }

    private static boolean putNormalizedEndpoint(LinkedHashMap<String, String> normalized, String instance,
        String endpoint, int depth) {
        EndpointValue endpointValue = normalizeEndpointValue(instance, endpoint, depth);
        if (endpointValue.value() != null) {
            normalized.put(instance, endpointValue.value());
        }
        return endpointValue.malformedJson();
    }

    private static EndpointValue normalizeEndpointValue(String instance, String endpoint, int depth) {
        String value = StringUtils.trimToNull(endpoint);
        if (value == null) {
            return new EndpointValue(null, false);
        }
        if (!startsLikeJsonObject(value)) {
            return new EndpointValue(value, false);
        }
        if (depth <= 0 || !looksLikeJsonObject(value)) {
            return new EndpointValue(value, true);
        }
        try {
            Map<String, String> parsed = OBJECT_MAPPER.readValue(value, STRING_MAP_TYPE);
            NormalizeResult nested = normalizeInstanceEndpointsInternal(parsed, depth - 1);
            if (nested.malformedJson()) {
                return new EndpointValue(value, true);
            }
            String endpointValue = resolveInstanceEndpoint(nested.instanceEndpoints(), instance);
            return new EndpointValue(endpointValue, false);
        }
        catch (Exception e) {
            return new EndpointValue(value, true);
        }
    }

    public record EndpointRecordParseResult(String rawValue, LinkedHashMap<String, String> instanceEndpoints,
                                            boolean malformedJson) {
    }

    private record EndpointValue(String value, boolean malformedJson) {
    }

    private record NormalizeResult(LinkedHashMap<String, String> instanceEndpoints, boolean malformedJson) {

        private boolean isEmpty() {
            return instanceEndpoints == null || instanceEndpoints.isEmpty();
        }
    }
}
