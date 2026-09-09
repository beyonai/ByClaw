package com.iwhalecloud.byai.manager.domain.mail;

import java.time.Duration;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import org.springframework.data.redis.core.Cursor;
import org.springframework.data.redis.core.ScanOptions;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Service;

/** Per-user cross-instance projection lease plus durable dirty generation. */
@Service
public class MailAccountProjectionLeaseService {
    private static final Duration TTL = Duration.ofSeconds(120);
    private static final String LEASE = "byai:mail:projection:lease:";
    private static final String GENERATION = "byai:mail:projection:generation:";
    private static final String DIRTY = "byai:mail:projection:dirty";
    private static final DefaultRedisScript<Long> TRIGGER = new DefaultRedisScript<>(
        "redis.call('sadd', KEYS[1], ARGV[1]); return redis.call('incr', KEYS[2])", Long.class);
    private static final DefaultRedisScript<Long> RELEASE = new DefaultRedisScript<>(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        Long.class);
    private static final DefaultRedisScript<Long> CLEAN_IF_UNCHANGED = new DefaultRedisScript<>(
        "if redis.call('get', KEYS[1]) == ARGV[1] then "
            + "return redis.call('srem', KEYS[2], ARGV[2]) else return 0 end",
        Long.class);
    private static final DefaultRedisScript<Long> RENEW_IF_OWNER = new DefaultRedisScript<>(
        "if redis.call('get', KEYS[1]) == ARGV[1] then "
            + "return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end",
        Long.class);
    private final StringRedisTemplate redis;

    public MailAccountProjectionLeaseService(StringRedisTemplate redis) {
        this.redis = redis;
    }

    public long trigger(Long userId) {
        try {
            Long generation = redis.execute(TRIGGER, List.of(DIRTY, GENERATION + userId), userId.toString());
            if (generation == null) throw new IllegalStateException("generation unavailable");
            return generation;
        } catch (RuntimeException e) {
            throw new LeaseUnavailableException();
        }
    }

    public Optional<Lease> tryAcquire(Long userId) {
        try {
            String owner = UUID.randomUUID().toString();
            Boolean acquired = redis.opsForValue().setIfAbsent(LEASE + userId, owner, TTL);
            return Boolean.TRUE.equals(acquired) ? Optional.of(new Lease(userId, owner)) : Optional.empty();
        } catch (RuntimeException e) {
            throw new LeaseUnavailableException();
        }
    }

    public long generation(Long userId) {
        try {
            String value = redis.opsForValue().get(GENERATION + userId);
            return value == null ? 0L : Long.parseLong(value);
        } catch (RuntimeException e) {
            throw new LeaseUnavailableException();
        }
    }

    public void markClean(Long userId, long processedGeneration) {
        try {
            redis.execute(CLEAN_IF_UNCHANGED, List.of(GENERATION + userId, DIRTY),
                Long.toString(processedGeneration), userId.toString());
        } catch (RuntimeException e) {
            throw new LeaseUnavailableException();
        }
    }

    public boolean release(Lease lease) {
        try {
            Long result = redis.execute(RELEASE, Collections.singletonList(LEASE + lease.userId()), lease.owner());
            return result != null && result > 0;
        } catch (RuntimeException e) {
            return false;
        }
    }

    public void assertOwnedAndRenew(Lease lease) {
        try {
            Long renewed = redis.execute(RENEW_IF_OWNER, Collections.singletonList(LEASE + lease.userId()),
                lease.owner(), Long.toString(TTL.toMillis()));
            if (renewed == null || renewed == 0L) throw new LeaseLostException();
        } catch (LeaseLostException e) {
            throw e;
        } catch (RuntimeException e) {
            throw new LeaseUnavailableException();
        }
    }

    public Set<Long> dirtyUsers(int limit) {
        Set<Long> users = new LinkedHashSet<>();
        try (Cursor<String> cursor = redis.opsForSet().scan(DIRTY, ScanOptions.scanOptions().count(limit).build())) {
            while (cursor.hasNext() && users.size() < limit) {
                try {
                    users.add(Long.valueOf(cursor.next()));
                } catch (NumberFormatException ignored) {
                    // Ignore malformed non-secret maintenance state.
                }
            }
            return users;
        } catch (Exception e) {
            return Set.of();
        }
    }

    public record Lease(Long userId, String owner) { }

    public static class LeaseUnavailableException extends RuntimeException {
        LeaseUnavailableException() {
            super("Mail projection lease unavailable");
        }
    }


    public static class LeaseLostException extends RuntimeException {
        LeaseLostException() {
            super("Mail projection lease ownership lost");
        }
    }
}
