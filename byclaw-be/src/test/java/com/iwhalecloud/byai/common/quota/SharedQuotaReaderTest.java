package com.iwhalecloud.byai.common.quota;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.HashOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** The wire contract must distinguish optional absence from a corrupt published package. */
class SharedQuotaReaderTest {
    private final StringRedisTemplate redis = mock(StringRedisTemplate.class);
    @SuppressWarnings("unchecked")
    private final HashOperations<String, Object, Object> hashes = mock(HashOperations.class);
    private final SharedQuotaProperties properties = new SharedQuotaProperties();
    private final SharedQuotaReader reader = new SharedQuotaReader(redis, new ObjectMapper(), properties);

    @Test void readsExactSharedHashAndKeepsHumanAndAgentLimitsSeparate() throws Exception {
        when(redis.opsForHash()).thenReturn(hashes);
        when(hashes.entries("byclaw:shared:quota:v1:{42}")).thenReturn(snapshot("LIMITED", 1, "42", "7", 0));
        var quota = reader.read(42).orElseThrow();
        assertEquals(0, quota.memberLimit());
        assertEquals(3, quota.groupMemberLimit());
        assertEquals(2, quota.agentLimit());
        assertEquals("7", quota.revision());
    }

    @Test void missingAndExplicitUnlimitedDoNotRequireCommercialTables() throws Exception {
        when(redis.opsForHash()).thenReturn(hashes);
        when(hashes.entries(anyString())).thenReturn(Map.of(), snapshot("UNLIMITED", 1, "42", "7", 0));
        assertTrue(reader.read(42).isEmpty());
        assertTrue(reader.read(42).isEmpty());
    }

    @Test void malformedOrUnsupportedPresentSnapshotIsUnavailableEvenWithAllowPolicy() throws Exception {
        when(redis.opsForHash()).thenReturn(hashes);
        for (Map<Object, Object> invalid : java.util.List.of(Map.<Object, Object>of("revision", "7"),
            snapshot("LIMITED", 2, "42", "7", 1), snapshot("LIMITED", 1, "43", "7", 1),
            snapshot("LIMITED", 1, "42", "7", -1))) {
            when(hashes.entries(anyString())).thenReturn(invalid);
            assertEquals(503, assertThrows(ResponseStatusException.class, () -> reader.read(42)).getStatusCode().value());
        }
    }

    @Test void rejectsPayloadHashMismatch() throws Exception {
        when(redis.opsForHash()).thenReturn(hashes);
        var fields = new java.util.HashMap<>(snapshot("LIMITED", 1, "42", "7", 1));
        fields.put("payloadHash", "0".repeat(64));
        when(hashes.entries(anyString())).thenReturn(fields);
        assertThrows(ResponseStatusException.class, () -> reader.read(42));
    }

    @Test void rereadsCurrentRedisStateWithoutUsingPreviouslySuccessfulSnapshot() throws Exception {
        when(redis.opsForHash()).thenReturn(hashes);
        when(hashes.entries(anyString())).thenReturn(snapshot("LIMITED", 1, "42", "7", 3), Map.of());
        assertEquals(3, reader.read(42).orElseThrow().memberLimit());
        assertTrue(reader.read(42).isEmpty());
    }

    @Test void wrongRedisTypeIsPresentCorruptionEvenUnderAllowPolicy() {
        when(redis.opsForHash()).thenReturn(hashes);
        when(hashes.entries(anyString())).thenThrow(new org.springframework.data.redis.RedisSystemException(
            "command failed", new IllegalStateException("WRONGTYPE Operation against a key holding the wrong kind of value")));
        assertEquals(503, assertThrows(ResponseStatusException.class, () -> reader.read(42)).getStatusCode().value());
    }

    @Test void stringAndFractionalLimitsAndInvalidTimestampCannotAuthorizeAdmission() throws Exception {
        when(redis.opsForHash()).thenReturn(hashes);
        String valid = (String) snapshot("LIMITED", 1, "42", "7", 1).get("payload");
        for (String invalid : java.util.List.of(valid.replace("\"memberLimit\":1", "\"memberLimit\":\"1\""),
            valid.replace("\"memberLimit\":1", "\"memberLimit\":1.5"),
            valid.replace("2026-10-27T00:00:00Z", "2026-10-27"))) {
            when(hashes.entries(anyString())).thenReturn(wire(invalid, "7"));
            assertThrows(ResponseStatusException.class, () -> reader.read(42));
        }
    }

    @Test void rejectsTrailingJsonOrGarbageDespiteACorrectPayloadDigest() throws Exception {
        when(redis.opsForHash()).thenReturn(hashes);
        String valid = (String) snapshot("LIMITED", 1, "42", "7", 1).get("payload");
        for (String invalid : java.util.List.of(valid + " {}", valid + " garbage")) {
            when(hashes.entries(anyString())).thenReturn(wire(invalid, "7"));
            assertThrows(ResponseStatusException.class, () -> reader.read(42));
        }
    }

    @Test void outageDefaultsToAllowButCanBeConfiguredToReject() {
        when(redis.opsForHash()).thenThrow(new org.springframework.data.redis.RedisConnectionFailureException("offline"));
        assertTrue(reader.read(42).isEmpty());
        properties.setFailurePolicy(SharedQuotaProperties.FailurePolicy.REJECT);
        assertEquals(503, assertThrows(ResponseStatusException.class, () -> reader.read(42)).getStatusCode().value());
    }

    private Map<Object, Object> snapshot(String mode, int schema, String enterprise, String revision, int members) throws Exception {
        String payload = "{\"schemaVersion\":" + schema + ",\"enterpriseId\":\"" + enterprise
            + "\",\"revision\":\"" + revision + "\",\"mode\":\"" + mode
            + "\",\"limits\":{\"memberLimit\":" + members + ",\"groupLimit\":5,\"groupMemberLimit\":3,\"agentLimit\":2},\"updatedAt\":\"2026-10-27T00:00:00Z\"}";
        return wire(payload, revision);
    }

    private Map<Object, Object> wire(String payload, String revision) throws Exception {
        return Map.of("revision", revision, "payload", payload, "payloadHash", HexFormat.of().formatHex(
            MessageDigest.getInstance("SHA-256").digest(payload.getBytes(StandardCharsets.UTF_8))));
    }
}
