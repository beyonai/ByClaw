package com.iwhalecloud.byai.common.quota;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.OffsetDateTime;
import java.util.HexFormat;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/** Reads every admission from Redis without a stale local fallback. */
@Component
public class SharedQuotaReader {
    private static final Logger LOG = LoggerFactory.getLogger(SharedQuotaReader.class);
    private final StringRedisTemplate redis;
    private final ObjectMapper mapper;
    private final SharedQuotaProperties properties;

    public SharedQuotaReader(StringRedisTemplate redis, ObjectMapper mapper, SharedQuotaProperties properties) {
        this.redis = redis; this.mapper = mapper; this.properties = properties;
    }

    public Optional<QuotaSnapshot> read(long enterpriseId) {
        if (enterpriseId <= 0) throw new IllegalArgumentException("Quota enterpriseId must be positive");
        String key = properties.getKeyPrefix() + "{" + enterpriseId + "}";
        Map<Object, Object> fields;
        try {
            fields = redis.opsForHash().entries(key);
        } catch (RuntimeException failure) {
            // WRONGTYPE is a present corrupt snapshot, never permission to bypass the package.
            if (hasWrongType(failure) || properties.getFailurePolicy() == SharedQuotaProperties.FailurePolicy.REJECT) {
                throw unavailable();
            }
            LOG.warn("Shared quota Redis unavailable; allowing admission for enterpriseId={}", enterpriseId);
            return Optional.empty();
        }
        if (fields == null || fields.isEmpty()) return Optional.empty();
        try {
            String revision = textField(fields.get("revision"));
            String payload = textField(fields.get("payload"));
            String hash = textField(fields.get("payloadHash"));
            if (!revision.matches("[1-9][0-9]*") || !hash.matches("[0-9a-f]{64}")) throw new IllegalArgumentException();
            Long.parseLong(revision);
            String actualHash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(payload.getBytes(StandardCharsets.UTF_8)));
            if (!MessageDigest.isEqual(hash.getBytes(StandardCharsets.US_ASCII), actualHash.getBytes(StandardCharsets.US_ASCII))) {
                throw new IllegalArgumentException();
            }
            JsonNode root = mapper.reader().with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(payload);
            if (root == null || !root.isObject() || !root.path("schemaVersion").isIntegralNumber()
                || !root.path("schemaVersion").canConvertToInt() || root.path("schemaVersion").intValue() != 1
                || !root.path("enterpriseId").isTextual() || !Long.toString(enterpriseId).equals(root.path("enterpriseId").textValue())
                || !root.path("revision").isTextual() || !revision.equals(root.path("revision").textValue())
                || !root.path("updatedAt").isTextual()) throw new IllegalArgumentException();
            OffsetDateTime.parse(root.path("updatedAt").textValue());
            JsonNode limits = root.path("limits");
            QuotaSnapshot snapshot = new QuotaSnapshot(enterpriseId, revision, limit(limits, "memberLimit"),
                limit(limits, "groupLimit"), limit(limits, "groupMemberLimit"), limit(limits, "agentLimit"));
            String accessMode = root.path("accessMode").isTextual() ? root.path("accessMode").textValue() : null;
            java.time.OffsetDateTime from = root.path("effectiveFrom").isTextual() ? java.time.OffsetDateTime.parse(root.path("effectiveFrom").textValue()) : null;
            java.time.OffsetDateTime to = root.path("effectiveTo").isTextual() ? java.time.OffsetDateTime.parse(root.path("effectiveTo").textValue()) : null;
            snapshot = new QuotaSnapshot(enterpriseId, revision, snapshot.memberLimit(), snapshot.groupLimit(), snapshot.groupMemberLimit(), snapshot.agentLimit(), accessMode, from, to);
            if (!root.path("mode").isTextual()) throw new IllegalArgumentException();
            return switch (root.path("mode").textValue()) {
                case "LIMITED" -> Optional.of(snapshot);
                case "UNLIMITED" -> Optional.empty();
                default -> throw new IllegalArgumentException();
            };
        } catch (Exception invalid) {
            LOG.warn("Shared quota snapshot invalid for enterpriseId={}", enterpriseId);
            throw unavailable();
        }
    }

    private static String textField(Object value) {
        if (!(value instanceof String text) || text.isEmpty()) throw new IllegalArgumentException();
        return text;
    }
    private static int limit(JsonNode limits, String name) {
        JsonNode value = limits.path(name);
        if (!limits.isObject() || !value.isIntegralNumber() || !value.canConvertToInt() || value.intValue() < 0) {
            throw new IllegalArgumentException();
        }
        return value.intValue();
    }
    private static boolean hasWrongType(Throwable error) {
        for (Throwable cause = error; cause != null; cause = cause.getCause()) {
            if (cause.getMessage() != null && cause.getMessage().contains("WRONGTYPE")) return true;
        }
        return false;
    }
    private static ResponseStatusException unavailable() {
        return new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "tenant.quota.unavailable");
    }
}
