package com.iwhalecloud.byai.common.hook;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import okhttp3.Headers;
import okhttp3.Request;
import okio.Buffer;

/** Configurable HMAC authentication over final request metadata; no receiver-specific protocol is built in. */
final class HmacHookSigner {
    private static final Set<String> SOURCES = Set.of("auth.clientId", "request.method", "request.path", "request.query",
        "request.timestamp", "request.nonce", "request.bodySha256");
    private static final Set<String> RESERVED_HEADERS = Set.of("host", "content-length", "transfer-encoding", "connection",
        "idempotency-key", "x-hook-event-id", "x-hook-subscription-id");
    private static final String REQUEST_HEADER_PREFIX = "request.headers.";

    /** Validate only whitelisted field references and header names; never include rejected secret values in diagnostics. */
    static void validate(HookProperties.Http http, String path, List<String> errors) {
        HookProperties.Auth auth = http.getAuth();
        if (!"hmac-sha256".equals(auth.getType())) {
            return;
        }
        if (auth.getSecret() == null || auth.getSecret().isBlank() || auth.getSecret().length() < 32
            || auth.getSecret().contains("${")) {
            errors.add(path + ".http.auth.secret: require an independently generated secret of at least 32 characters");
        }
        // Transport URLs may use HTTP or HTTPS; HookRequestMapper validates the URL scheme.
        if (auth.getToken() != null || http.getHeaders().keySet().stream().anyMatch("Authorization"::equalsIgnoreCase)) {
            errors.add(path + ".http.auth: HMAC cannot be combined with another credential");
        }
        if (auth.getCanonicalFields().isEmpty() || auth.getCanonicalFields().size() > 32) {
            errors.add(path + ".http.auth.canonical-fields: configure 1-32 literal or request fields");
        }
        if (auth.getSeparator() == null || auth.getSeparator().length() > 16) {
            errors.add(path + ".http.auth.separator: require a separator of at most 16 characters");
        }
        for (int index = 0; index < auth.getCanonicalFields().size(); index++) {
            validateField(auth.getCanonicalFields().get(index), path + ".http.auth.canonical-fields[" + index + "]", false, errors);
        }
        boolean needsClient = auth.getCanonicalFields().stream().anyMatch(field -> "auth.clientId".equals(field.getFrom()))
            || auth.getHeaders().values().stream().anyMatch(field -> "auth.clientId".equals(field.getFrom()));
        if (needsClient && (auth.getClientId() == null || !auth.getClientId().matches("[a-zA-Z0-9_-]{1,64}"))) {
            errors.add(path + ".http.auth.client-id: require 1-64 letters, digits, underscores or hyphens");
        }
        if (auth.getHeaders().isEmpty() || auth.getHeaders().size() > 16) {
            errors.add(path + ".http.auth.headers: configure 1-16 authentication headers");
        }
        Set<String> names = new HashSet<>();
        auth.getHeaders().forEach((name, field) -> {
            String fieldPath = path + ".http.auth.headers." + name;
            validateField(field, fieldPath, true, errors);
            try {
                new Headers.Builder().add(name, field.isValuePresent() && field.getValue() instanceof String value ? value : "");
                if (!names.add(name.toLowerCase(Locale.ROOT)) || RESERVED_HEADERS.contains(name.toLowerCase(Locale.ROOT))
                    || http.getHeaders().keySet().stream().anyMatch(name::equalsIgnoreCase)) {
                    errors.add(fieldPath + ": duplicate, reserved or statically overridden authentication header");
                }
            } catch (RuntimeException invalid) {
                errors.add(fieldPath + ": invalid header name or literal value");
            }
        });
    }

    /** Restrict source references instead of evaluating scripts, expressions or arbitrary configuration properties. */
    private static void validateField(HookProperties.Field field, String path, boolean allowSignature, List<String> errors) {
        boolean hasFrom = field.getFrom() != null && !field.getFrom().isBlank();
        if (hasFrom == field.isValuePresent()) {
            errors.add(path + ": configure exactly one of from and value");
            return;
        }
        if (field.isValuePresent()) {
            if (!(field.getValue() instanceof String)) {
                errors.add(path + ": authentication literal values must be strings");
            }
            return;
        }
        String from = field.getFrom();
        if (SOURCES.contains(from) || (allowSignature && "signature".equals(from))) {
            return;
        }
        if (from.startsWith(REQUEST_HEADER_PREFIX)) {
            try {
                new Headers.Builder().add(from.substring(REQUEST_HEADER_PREFIX.length()), "");
                return;
            } catch (RuntimeException invalid) {
                // Report only the mapping's configuration path.
            }
        }
        errors.add(path + ": unsupported authentication field reference");
    }

    /** Recompute per-attempt metadata, then sign the exact byte body and emit only configured output headers. */
    Request sign(Request request, HookProperties.Auth auth) throws java.io.IOException {
        if (!"hmac-sha256".equals(auth.getType())) {
            return request;
        }
        Buffer body = new Buffer();
        if (request.body() != null) {
            request.body().writeTo(body);
        }
        Map<String, String> fields = new HashMap<>();
        fields.put("auth.clientId", auth.getClientId());
        fields.put("request.method", request.method());
        fields.put("request.path", request.url().encodedPath());
        fields.put("request.query", request.url().encodedQuery() == null ? "" : request.url().encodedQuery());
        fields.put("request.timestamp", Long.toString(Instant.now().getEpochSecond()));
        fields.put("request.nonce", UUID.randomUUID().toString());
        try {
            fields.put("request.bodySha256", HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(body.readByteArray())));
            String canonical = String.join(auth.getSeparator(), auth.getCanonicalFields().stream()
                .map(field -> resolve(field, request, fields)).toList());
            Mac hmac = Mac.getInstance("HmacSHA256");
            hmac.init(new SecretKeySpec(auth.getSecret().getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            fields.put("signature", HexFormat.of().formatHex(hmac.doFinal(canonical.getBytes(StandardCharsets.UTF_8))));
            Request.Builder signed = request.newBuilder();
            auth.getHeaders().forEach((name, field) -> signed.header(name, resolve(field, request, fields)));
            return signed.build();
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException("Cannot sign outbound hook request");
        }
    }

    /** Resolve a validated source; request headers are case-insensitive and absent headers contribute an empty segment. */
    private String resolve(HookProperties.Field field, Request request, Map<String, String> fields) {
        if (field.isValuePresent()) {
            return (String) field.getValue();
        }
        if (field.getFrom().startsWith(REQUEST_HEADER_PREFIX)) {
            String value = request.header(field.getFrom().substring(REQUEST_HEADER_PREFIX.length()));
            return value == null ? "" : value;
        }
        return fields.get(field.getFrom());
    }
}
