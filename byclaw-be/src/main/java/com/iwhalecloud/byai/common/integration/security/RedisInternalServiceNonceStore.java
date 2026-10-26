package com.iwhalecloud.byai.common.integration.security;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import java.time.Duration;
/** SET NX with expiry spans all backend replicas. */
@Component
public class RedisInternalServiceNonceStore implements InternalServiceNonceStore {
    private final StringRedisTemplate redis;
    public RedisInternalServiceNonceStore(StringRedisTemplate redis) { this.redis = redis; }
    public boolean reserve(String key, Duration ttl) {
        return Boolean.TRUE.equals(redis.opsForValue().setIfAbsent("byclaw:service:nonce:" + key, "1", ttl));
    }
}
