package com.iwhalecloud.byai.manager.domain.tenant;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

import org.springframework.core.io.ClassPathResource;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/** Publishes the authoritative tenant_config rows as one fenced Redis Hash snapshot. */
@Service
public class TenantConfigPublisher {

    private static final Set<String> REQUIRED = Set.of("DB_HOST", "DB_PORT", "DB_NAME", "DB_USER",
        "DB_PASSWORD", "DB_SANDBOX_RECORD_ID", "DB_CREDENTIAL_VERSION", "PROVISION_STATE");

    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;
    private final DefaultRedisScript<Long> script;

    public TenantConfigPublisher(StringRedisTemplate redisTemplate, ObjectMapper objectMapper) {
        this.redisTemplate = redisTemplate;
        this.objectMapper = objectMapper;
        this.script = new DefaultRedisScript<>();
        script.setLocation(new ClassPathResource("tenant/tenant-config-publish.lua"));
        script.setResultType(Long.class);
    }

    public boolean publish(long enterpriseId, Map<String, String> configRows) {
        if (enterpriseId <= 0 || configRows == null || !configRows.keySet().containsAll(REQUIRED)) {
            throw new IllegalArgumentException("tenant config snapshot is incomplete");
        }
        TreeMap<String, String> rows = new TreeMap<>(configRows);
        for (Map.Entry<String, String> row : rows.entrySet()) {
            if (!row.getKey().matches("[A-Z][A-Z0-9_]{0,63}") || row.getValue() == null
                || row.getValue().isBlank()) {
                throw new IllegalArgumentException("invalid tenant config row");
            }
        }
        try {
            JsonNode state = objectMapper.readTree(rows.get("PROVISION_STATE"));
            if (state.path("generation").asLong(0) <= 0 || state.path("fencingToken").asLong(0) <= 0
                || Long.parseLong(rows.get("DB_CREDENTIAL_VERSION")) <= 0
                || !("byclaw_t_" + enterpriseId).equals(rows.get("DB_NAME"))
                || !("bc_t_" + enterpriseId + "_admin").equals(rows.get("DB_USER"))) {
                throw new IllegalArgumentException("invalid tenant config identity or version");
            }
        }
        catch (IllegalArgumentException e) {
            throw e;
        }
        catch (Exception e) {
            throw new IllegalArgumentException("invalid tenant provision state", e);
        }
        List<String> args = new ArrayList<>(2 + rows.size() * 2);
        args.add(rows.get("PROVISION_STATE"));
        args.add(rows.get("DB_CREDENTIAL_VERSION"));
        rows.forEach((code, value) -> {
            args.add(code);
            args.add(value);
        });
        Long result = redisTemplate.execute(script, List.of("TENANT_CONFIG_" + enterpriseId), args.toArray());
        return Long.valueOf(1L).equals(result);
    }
}
