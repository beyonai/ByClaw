package com.iwhalecloud.byai.state.domain.chat.service;

import java.util.Collections;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Service;

/**
 * 为单个 session 的 Redis Stream listener 提供 Redis Cluster 可用的单 key lease。
 * <p>
 * 获取使用 SET NX EX；续租和释放脚本只访问 lease 自身的 key，不与 Stream key 跨 slot 组合操作。
 */
@Service
public class SessionStreamLeaseService {

    private static final long LEASE_TTL_SECONDS = 120L;
    private static final String LEASE_KEY_PREFIX = "byai:chat:stream-lease:";

    private static final DefaultRedisScript<Long> RENEW_SCRIPT = new DefaultRedisScript<>(
        "if redis.call('get', KEYS[1]) == ARGV[1] then "
            + "return redis.call('expire', KEYS[1], ARGV[2]) "
            + "else return 0 end", Long.class);

    private static final DefaultRedisScript<Long> RELEASE_SCRIPT = new DefaultRedisScript<>(
        "if redis.call('get', KEYS[1]) == ARGV[1] then "
            + "return redis.call('del', KEYS[1]) "
            + "else return 0 end", Long.class);

    @Autowired
    private RedisTemplate<String, Object> redisTemplate;

    @Autowired
    private ChatRuntimeInstance chatRuntimeInstance;

    public Optional<Lease> tryAcquire(String sessionId) {
        if (sessionId == null || sessionId.isBlank()) {
            return Optional.empty();
        }
        String token = chatRuntimeInstance.getInstanceId() + ":" + UUID.randomUUID();
        boolean acquired = Boolean.TRUE.equals(redisTemplate.opsForValue()
            .setIfAbsent(buildKey(sessionId), token, LEASE_TTL_SECONDS, TimeUnit.SECONDS));
        return acquired ? Optional.of(new Lease(sessionId, token)) : Optional.empty();
    }

    public boolean renew(Lease lease) {
        return executeOwnerScript(RENEW_SCRIPT, lease);
    }

    public boolean release(Lease lease) {
        return executeOwnerScript(RELEASE_SCRIPT, lease);
    }

    public String buildKey(String sessionId) {
        return LEASE_KEY_PREFIX + sessionId;
    }

    private boolean executeOwnerScript(DefaultRedisScript<Long> script, Lease lease) {
        if (lease == null || lease.sessionId() == null || lease.token() == null) {
            return false;
        }
        Long result = redisTemplate.execute(script, Collections.singletonList(buildKey(lease.sessionId())),
            lease.token(), String.valueOf(LEASE_TTL_SECONDS));
        return result != null && result > 0;
    }

    public record Lease(String sessionId, String token) {
    }
}
