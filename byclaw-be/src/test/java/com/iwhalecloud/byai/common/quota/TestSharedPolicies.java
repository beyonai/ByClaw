package com.iwhalecloud.byai.common.quota;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.data.redis.core.HashOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import static org.mockito.Mockito.*;

/** Test HACU publications through the production Redis reader; no second SQL rule store. */
public class TestSharedPolicies {
    public final SharedQuotaReader reader;
    public final Map<String, Map<Object,Object>> values = new ConcurrentHashMap<>();
    private final ObjectMapper json = new ObjectMapper();
    @SuppressWarnings("unchecked")
    public TestSharedPolicies() {
        var redis = mock(StringRedisTemplate.class);
        HashOperations<String,Object,Object> hashes = mock(HashOperations.class);
        when(redis.opsForHash()).thenReturn(hashes);
        when(hashes.entries(anyString())).thenAnswer(call -> values.getOrDefault(call.getArgument(0), Map.of()));
        reader = new SharedQuotaReader(redis, json, new SharedQuotaProperties());
    }
    public void publish(long tenant, JsonNode policy) {
        try {
            var payload = json.createObjectNode().put("schemaVersion",1).put("enterpriseId",Long.toString(tenant))
                .put("revision",policy.path("revision").asText("1")).put("mode","LIMITED")
                .put("updatedAt","2026-10-29T00:00:00Z");
            payload.set("limits",policy.path("limits").isObject() ? policy.path("limits") :
                json.readTree("{\"memberLimit\":2,\"groupLimit\":3,\"groupMemberLimit\":4,\"agentLimit\":5}"));
            if (policy.has("accessMode")) payload.set("accessMode",policy.get("accessMode"));
            if (policy.has("effectiveFrom")) payload.set("effectiveFrom",policy.get("effectiveFrom"));
            if (policy.has("effectiveUntil")) payload.set("effectiveTo",policy.get("effectiveUntil"));
            String raw = payload.toString();
            values.put("byclaw:shared:quota:v1:{"+tenant+"}",Map.of("revision",payload.path("revision").asText(),
                "payload",raw,"payloadHash",HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(raw.getBytes(StandardCharsets.UTF_8)))));
        } catch (Exception invalid) { throw new IllegalArgumentException(invalid); }
    }
}
