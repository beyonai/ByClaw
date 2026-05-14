package com.iwhalecloud.byai.gateway.sandbox.service;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.iwhalecloud.byai.gateway.sandbox.config.SandboxProperties;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;

/**
 * Redis-backed metadata view for query acceleration. Lifecycle state is owned by DB.
 */
@Service
public class SandboxMetadataCache {

    private static final Logger log = LoggerFactory.getLogger(SandboxMetadataCache.class);
    private static final String REDIS_KEY_PREFIX = "byai:worker:sandbox:";
    private static final String REDIS_USER_INDEX_PREFIX = "byai:worker:sandbox:user-index:";

    private final StringRedisTemplate redisTemplate;
    private final SandboxProperties properties;
    private final ObjectMapper objectMapper;

    public SandboxMetadataCache(StringRedisTemplate redisTemplate, SandboxProperties properties) {
        this.redisTemplate = redisTemplate;
        this.properties = properties;
        this.objectMapper = new ObjectMapper();
        this.objectMapper.registerModule(new JavaTimeModule());
        this.objectMapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
    }

    public void put(SandboxInfo info) {
        if (info == null || isBlank(info.getUserCode()) || isBlank(info.getSandboxType())) {
            return;
        }
        try {
            long ttlSeconds = Math.max(60L, properties.getMetadataCacheTtl().toSeconds());
            String redisKey = buildRedisKey(info.getUserCode(), info.getSandboxType());
            String userIndexKey = buildUserIndexKey(info.getUserCode());
            redisTemplate.opsForValue().set(redisKey, objectMapper.writeValueAsString(info), ttlSeconds, TimeUnit.SECONDS);
            redisTemplate.opsForSet().add(userIndexKey, info.getSandboxType());
            redisTemplate.expire(userIndexKey, ttlSeconds, TimeUnit.SECONDS);
        }
        catch (Exception e) {
            log.warn("Failed to cache sandbox metadata, user={}, type={}, reason={}",
                info.getUserCode(), info.getSandboxType(), e.getMessage());
        }
    }

    public List<SandboxInfo> listByUser(String userCode) {
        if (isBlank(userCode)) {
            return List.of();
        }
        Set<String> sandboxTypes = redisTemplate.opsForSet().members(buildUserIndexKey(userCode));
        if (sandboxTypes == null || sandboxTypes.isEmpty()) {
            return List.of();
        }
        List<SandboxInfo> result = new ArrayList<>();
        for (String sandboxType : sandboxTypes) {
            String json = redisTemplate.opsForValue().get(buildRedisKey(userCode, sandboxType));
            SandboxInfo info = deserialize(json);
            if (info != null) {
                result.add(info);
            }
            else {
                redisTemplate.opsForSet().remove(buildUserIndexKey(userCode), sandboxType);
            }
        }
        return result;
    }

    public void evict(String userCode, String sandboxType) {
        if (isBlank(userCode) || isBlank(sandboxType)) {
            return;
        }
        redisTemplate.delete(buildRedisKey(userCode, sandboxType));
        redisTemplate.opsForSet().remove(buildUserIndexKey(userCode), sandboxType);
    }

    private SandboxInfo deserialize(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return objectMapper.readValue(json, SandboxInfo.class);
        }
        catch (Exception e) {
            log.warn("Failed to deserialize sandbox metadata: {}", e.getMessage());
            return null;
        }
    }

    private String buildRedisKey(String userCode, String sandboxType) {
        return REDIS_KEY_PREFIX + userCode + ":" + sandboxType;
    }

    private String buildUserIndexKey(String userCode) {
        return REDIS_USER_INDEX_PREFIX + userCode;
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
