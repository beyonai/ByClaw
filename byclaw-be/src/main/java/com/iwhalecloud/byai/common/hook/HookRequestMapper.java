package com.iwhalecloud.byai.common.hook;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import okhttp3.Headers;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.Request;
import okhttp3.RequestBody;

/** Validates deployment configuration and maps whitelisted values without evaluating expressions. */
final class HookRequestMapper {
    private static final Set<String> EVENT_PATHS = Set.of("event.id", "event.type", "event.version", "event.occurredAt", "event.occurredAtEpochSeconds");
    private static final Set<String> RESERVED_HEADERS = Set.of("host", "content-length", "transfer-encoding",
        "connection", "idempotency-key", "x-hook-event-id", "x-hook-subscription-id");
    private final ObjectMapper json = new ObjectMapper();

    void validate(HookProperties properties, List<HookEventSchema> schemas) {
        List<String> errors = new ArrayList<>();
        validateTimeout("defaults.connect-timeout", properties.getDefaults().getConnectTimeout(), errors);
        validateTimeout("defaults.call-timeout", properties.getDefaults().getCallTimeout(), errors);
        Set<String> schemaKeys = new HashSet<>();
        for (HookEventSchema schema : schemas) {
            if (!schemaKeys.add(schema.type() + ":" + schema.version())) {
                errors.add("duplicate hook event schema");
            }
        }
        properties.getSubscriptions().forEach((id, subscription) -> {
            if (!subscription.isEnabled()) {
                return;
            }
            String path = "subscriptions." + id;
            if (!id.matches("[a-zA-Z0-9_-]{1,64}")) {
                errors.add("subscriptions: subscription IDs must use 1-64 letters, digits, underscores or hyphens");
            }
            HookEventSchema schema = schemas.stream().filter(candidate -> candidate.type().equals(subscription.getEvent())
                && candidate.version() == subscription.getEventVersion()).findFirst().orElse(null);
            if (schema == null) {
                errors.add(path + ".event: unknown event or unsupported event-version");
            }
            for (String field : subscription.getRequiredDataFields()) {
                if (schema == null || !schema.dataFields().contains(field)) {
                    errors.add(path + ".required-data-fields: fields must be declared by the event schema");
                }
            }
            HookProperties.Retry retry = subscription.getRetry();
            if (retry.getMaxAttempts() < 1 || retry.getMaxAttempts() > 100) {
                errors.add(path + ".retry.max-attempts: must be between 1 and 100");
            }
            if (retry.getDelay() == null || retry.getDelay().compareTo(java.time.Duration.ofMillis(100)) < 0
                || retry.getDelay().compareTo(java.time.Duration.ofMinutes(5)) > 0) {
                errors.add(path + ".retry.delay: must be between 100ms and 5m");
            }
            if (retry.getStatuses().stream().anyMatch(code -> code == null || code < 400 || code > 599)) {
                errors.add(path + ".retry.statuses: must contain only HTTP error status codes");
            }
            HookProperties.Http http = subscription.getHttp();
            HttpUrl url = http.getUrl() == null ? null : HttpUrl.parse(http.getUrl());
            if (url == null || !url.username().isEmpty() || !url.password().isEmpty() || url.fragment() != null
                || http.getUrl().contains("${")) {
                errors.add(path + ".http.url: require an HTTP(S) URL without userinfo, fragment or unresolved placeholders");
            }
            if (!Set.of("POST", "PUT", "PATCH", "DELETE", "GET").contains(http.getMethod())) {
                errors.add(path + ".http.method: supported methods are POST, PUT, PATCH, DELETE and GET");
            }
            if ("GET".equals(http.getMethod()) && !http.getBody().isEmpty()) {
                errors.add(path + ".http.body: GET must not have a body");
            }
            http.getHeaders().forEach((name, value) -> {
                try {
                    new Headers.Builder().add(name, value);
                    if (RESERVED_HEADERS.contains(name.toLowerCase(Locale.ROOT)) || value.contains("${")) {
                        errors.add(path + ".http.headers: reserved header or unresolved placeholder");
                    }
                    if ("content-type".equalsIgnoreCase(name) && !"application/json".equalsIgnoreCase(value)) {
                        errors.add(path + ".http.headers.Content-Type: only application/json is supported");
                    }
                } catch (RuntimeException exception) {
                    errors.add(path + ".http.headers: invalid header name or value");
                }
            });
            HookProperties.Auth auth = http.getAuth();
            if (!Set.of("none", "bearer", "hmac-sha256").contains(auth.getType())) {
                errors.add(path + ".http.auth.type: supported types are none, bearer and hmac-sha256");
            }
            if ("bearer".equals(auth.getType())) {
                if (auth.getToken() == null || auth.getToken().isBlank() || auth.getToken().contains("${")
                    || !auth.getToken().matches("[\\x21-\\x7E]+")) {
                    errors.add(path + ".http.auth.token: require a nonblank ASCII bearer token");
                }
                if (http.getHeaders().keySet().stream().anyMatch("Authorization"::equalsIgnoreCase)) {
                    errors.add(path + ".http.auth: do not combine bearer auth with an Authorization header");
                }
            }
            HmacHookSigner.validate(http, path, errors);
            http.getBody().forEach((name, field) -> {
                boolean hasFrom = field.getFrom() != null && !field.getFrom().isBlank();
                if (hasFrom == field.isValuePresent()) {
                    errors.add(path + ".http.body." + name + ": configure exactly one of from and value");
                } else if (hasFrom && !EVENT_PATHS.contains(field.getFrom()) && (schema == null
                    || !field.getFrom().startsWith("data.") || !schema.dataFields().contains(field.getFrom().substring(5)))) {
                    errors.add(path + ".http.body." + name + ": field is not declared by the event schema");
                }
            });
        });
        if (!errors.isEmpty()) {
            // Do not include rejected values: URLs and headers may contain deployment credentials.
            throw new IllegalArgumentException("Invalid byclaw.hooks configuration:\n" + String.join("\n", errors));
        }
    }

    private void validateTimeout(String field, java.time.Duration value, List<String> errors) {
        if (value == null || value.compareTo(java.time.Duration.ofMillis(1)) < 0
            || value.compareTo(java.time.Duration.ofSeconds(60)) > 0) {
            errors.add(field + ": must be between 1ms and 60s");
        }
    }

    ObjectNode snapshot(HookEventSchema schema, String eventId, Map<String, Object> data) {
        ObjectNode envelope = json.createObjectNode();
        java.time.Instant occurredAt = java.time.Instant.now();
        envelope.putObject("event").put("id", eventId).put("type", schema.type()).put("version", schema.version())
            .put("occurredAt", occurredAt.toString()).put("occurredAtEpochSeconds", occurredAt.getEpochSecond());
        ObjectNode payload = envelope.putObject("data");
        schema.dataFields().forEach(field -> {
            if (data.containsKey(field)) {
                payload.set(field, json.valueToTree(data.get(field)));
            }
        });
        return envelope;
    }

    Request map(String subscriptionId, HookProperties.Subscription subscription, ObjectNode envelope) {
        HookProperties.Http http = subscription.getHttp();
        ObjectNode body = envelope;
        if (!http.getBody().isEmpty()) {
            body = json.createObjectNode();
            for (var entry : http.getBody().entrySet()) {
                HookProperties.Field field = entry.getValue();
                JsonNode value = field.isValuePresent() ? json.valueToTree(field.getValue())
                    : envelope.at("/" + field.getFrom().replace('.', '/'));
                if (value.isMissingNode()) {
                    throw new IllegalArgumentException("hook event is missing a declared field");
                }
                body.set(entry.getKey(), value);
            }
        }
        Request.Builder request = new Request.Builder().url(http.getUrl());
        http.getHeaders().forEach(request::header);
        if ("bearer".equals(http.getAuth().getType())) {
            request.header("Authorization", "Bearer " + http.getAuth().getToken());
        }
        String eventId = envelope.path("event").path("id").asText();
        request.header("X-Hook-Event-Id", eventId).header("X-Hook-Subscription-Id", subscriptionId)
            .header("Idempotency-Key", eventId + ":" + subscriptionId);
        return request.method(http.getMethod(), "GET".equals(http.getMethod()) ? null
            : RequestBody.create(body.toString(), MediaType.get("application/json; charset=utf-8"))).build();
    }
}
