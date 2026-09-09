package com.iwhalecloud.byai.manager.domain.connector.authorization;

import java.time.Duration;
import java.util.Collections;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Service;

@Service
public class ConnectorCredentialRenewalLeaseService {
    private static final Duration TTL = Duration.ofSeconds(120);
    private static final String PREFIX = "byai:connector:credential-renewal:";
    private static final DefaultRedisScript<Long> RELEASE_SCRIPT = new DefaultRedisScript<>(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        Long.class);
    private final StringRedisTemplate redisTemplate;

    public ConnectorCredentialRenewalLeaseService(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    public Optional<Lease> tryAcquire(Long authId) {
        if (authId == null) {
            return Optional.empty();
        }
        try {
            String token = UUID.randomUUID().toString();
            Boolean acquired = redisTemplate.opsForValue().setIfAbsent(key(authId), token, TTL);
            return Boolean.TRUE.equals(acquired) ? Optional.of(new Lease(authId, token)) : Optional.empty();
        } catch (RuntimeException e) {
            throw new ConnectorCredentialRenewalLeaseUnavailableException();
        }
    }

    public boolean release(Lease lease) {
        if (lease == null || lease.authId() == null || lease.ownerToken() == null) {
            return false;
        }
        try {
            Long result = redisTemplate.execute(RELEASE_SCRIPT, Collections.singletonList(key(lease.authId())),
                lease.ownerToken());
            return result != null && result > 0;
        } catch (RuntimeException e) {
            return false;
        }
    }

    private String key(Long authId) {
        return PREFIX + authId;
    }

    public record Lease(Long authId, String ownerToken) { }
}
