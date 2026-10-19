package com.iwhalecloud.byai.manager.domain.connector.provider.media;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

@Component
public class MediaModelConfigParser {

    public static final String MEDIA_MODEL_CONFIG_ATTRIBUTE = "mediaModelConfig";
    private static final Set<String> REQUIRED_KEYS = Set.of(
        "modelName", "modelCode", "modelProtocol", "apiEndpoint", "apiToken", "headersJson",
        "connectTimeoutSeconds", "readTimeoutSeconds", "maxRetryCount", "retryIntervalSeconds", "optionsJson");
    private static final Set<String> FORBIDDEN_HEADERS = Set.of(
        "connection", "content-length", "host", "transfer-encoding");
    private static final Pattern HEADER_NAME = Pattern.compile("[!#$%&'*+.^_`|~0-9A-Za-z-]+");
    private final ObjectMapper objectMapper;

    public MediaModelConfigParser(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public MediaModelConfig parse(
            Map<String, String> credentials, MediaModelType expectedType, String connectorCode) {
        if (credentials == null || !credentials.keySet().equals(REQUIRED_KEYS)) {
            throw invalid("fields");
        }
        String modelName = text(credentials, "modelName", 256);
        String modelCode = text(credentials, "modelCode", 256);
        String protocol = text(credentials, "modelProtocol", 128);
        String endpoint = endpoint(text(credentials, "apiEndpoint", 2048));
        String token = text(credentials, "apiToken", 4096);
        List<MediaModelHeader> headers = headers(credentials.get("headersJson"));
        Map<String, Object> options = options(credentials.get("optionsJson"));
        return new MediaModelConfig(
            1,
            UUID.randomUUID().toString(),
            connectorCode,
            modelName,
            modelCode,
            expectedType,
            protocol,
            endpoint,
            token,
            headers,
            integer(credentials, "connectTimeoutSeconds", 1, 600),
            integer(credentials, "readTimeoutSeconds", 1, 3600),
            integer(credentials, "maxRetryCount", 0, 3),
            integer(credentials, "retryIntervalSeconds", 0, 60),
            options
        );
    }

    public String serialize(MediaModelConfig config) {
        try {
            return objectMapper.writeValueAsString(config);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Unable to serialize media model connector configuration", e);
        }
    }

    private String text(Map<String, String> values, String key, int maxLength) {
        String value = values.get(key);
        if (!StringUtils.hasText(value) || value.length() > maxLength
                || value.chars().anyMatch(character -> Character.isISOControl(character))) {
            throw invalid(key);
        }
        return value.trim();
    }

    private int integer(Map<String, String> values, String key, int minimum, int maximum) {
        try {
            int parsed = Integer.parseInt(values.get(key));
            if (parsed < minimum || parsed > maximum) {
                throw invalid(key);
            }
            return parsed;
        } catch (NumberFormatException | NullPointerException e) {
            throw invalid(key);
        }
    }

    private String endpoint(String value) {
        try {
            URI uri = URI.create(value);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || !StringUtils.hasText(uri.getHost())
                    || uri.getUserInfo() != null || uri.getFragment() != null) {
                throw invalid("endpoint");
            }
            String host = uri.getHost();
            if (host.matches("[0-9.]+") || host.contains(":")) {
                InetAddress address = InetAddress.getByName(host);
                if (address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress()
                    || address.isSiteLocalAddress() || address.isMulticastAddress()) throw invalid("endpoint");
            }
            return uri.toString();
        } catch (IllegalArgumentException | UnknownHostException e) {
            throw invalid("endpoint");
        }
    }

    private List<MediaModelHeader> headers(String json) {
        try {
            List<MediaModelHeader> parsed = objectMapper.readValue(json, new TypeReference<>() { });
            if (parsed == null || parsed.size() > 32) {
                throw invalid("headers");
            }
            Set<String> names = new HashSet<>();
            for (MediaModelHeader header : parsed) {
                if (header == null || !StringUtils.hasText(header.name()) || !StringUtils.hasText(header.value())
                        || header.name().length() > 128 || header.value().length() > 4096
                        || !HEADER_NAME.matcher(header.name()).matches()
                        || header.value().chars().anyMatch(character -> Character.isISOControl(character))) {
                    throw invalid("headers");
                }
                String normalized = header.name().toLowerCase(Locale.ROOT);
                if (!names.add(normalized) || FORBIDDEN_HEADERS.contains(normalized)) {
                    throw invalid("headers");
                }
            }
            return List.copyOf(parsed);
        } catch (JsonProcessingException | RuntimeException e) {
            throw invalid("headers");
        }
    }

    private Map<String, Object> options(String json) {
        try {
            Map<String, Object> parsed = objectMapper.readValue(json, new TypeReference<LinkedHashMap<String, Object>>() { });
            if (parsed == null || parsed.size() > 32 || json.length() > 16 * 1024) {
                throw invalid("options");
            }
            return Map.copyOf(parsed);
        } catch (JsonProcessingException | RuntimeException e) {
            throw invalid("options");
        }
    }

    private IllegalArgumentException invalid(String field) {
        return new IllegalArgumentException("Invalid media model connector " + field);
    }
}
