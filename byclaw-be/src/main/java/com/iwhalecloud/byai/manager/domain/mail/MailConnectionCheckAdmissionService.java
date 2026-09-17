package com.iwhalecloud.byai.manager.domain.mail;

import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicBoolean;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Service;

/** Bounded node admission plus per-user cross-node concurrency and cooldown. */
@Service
public class MailConnectionCheckAdmissionService {

    private static final Duration LEASE_TTL = Duration.ofSeconds(60);
    private static final String LEASE_PREFIX = "byai:mail:connection-check:user:";
    private static final String RATE_PREFIX = "byai:mail:connection-check:rate:";
    private static final DefaultRedisScript<Long> ACQUIRE = new DefaultRedisScript<>(
        "if redis.call('exists', KEYS[1]) == 1 or redis.call('exists', KEYS[2]) == 1 then return 0 end "
            + "redis.call('psetex', KEYS[1], ARGV[2], ARGV[1]); "
            + "redis.call('psetex', KEYS[2], ARGV[3], '1'); return 1",
        Long.class);
    private static final DefaultRedisScript<Long> RENEW = new DefaultRedisScript<>(
        "if redis.call('get', KEYS[1]) == ARGV[1] then "
            + "return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end",
        Long.class);
    private static final DefaultRedisScript<Long> RELEASE = new DefaultRedisScript<>(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        Long.class);

    private final StringRedisTemplate redis;
    private final Semaphore nodePermits;
    private final long cooldownMillis;

    public MailConnectionCheckAdmissionService(
            StringRedisTemplate redis,
            @Value("${byclaw.mail.check.max-concurrency:16}") int maxConcurrency,
            @Value("${byclaw.mail.check.user-cooldown-ms:2000}") long cooldownMillis) {
        if (maxConcurrency < 1 || cooldownMillis < 1 || cooldownMillis > 60_000) {
            throw new IllegalArgumentException("Invalid mail connection check admission settings");
        }
        this.redis = redis;
        this.nodePermits = new Semaphore(maxConcurrency, true);
        this.cooldownMillis = cooldownMillis;
    }

    public Admission acquire(Long userId) {
        if (userId == null || !nodePermits.tryAcquire()) {
            throw new BusyException();
        }
        String owner = UUID.randomUUID().toString();
        try {
            Long acquired = redis.execute(ACQUIRE,
                List.of(LEASE_PREFIX + userId, RATE_PREFIX + userId), owner,
                Long.toString(LEASE_TTL.toMillis()), Long.toString(cooldownMillis));
            if (acquired == null || acquired == 0L) {
                throw new BusyException();
            }
            return new Admission(redis, nodePermits, userId, owner);
        } catch (BusyException e) {
            nodePermits.release();
            throw e;
        } catch (RuntimeException e) {
            nodePermits.release();
            throw new UnavailableException();
        }
    }

    public static class Admission implements AutoCloseable {
        private final StringRedisTemplate redis;
        private final Semaphore nodePermits;
        private final Long userId;
        private final String owner;
        private final AtomicBoolean closed = new AtomicBoolean();

        Admission(StringRedisTemplate redis, Semaphore nodePermits, Long userId, String owner) {
            this.redis = redis;
            this.nodePermits = nodePermits;
            this.userId = userId;
            this.owner = owner;
        }

        public void assertOwnedAndRenew() {
            try {
                Long renewed = redis.execute(RENEW, List.of(LEASE_PREFIX + userId), owner,
                    Long.toString(LEASE_TTL.toMillis()));
                if (renewed == null || renewed == 0L) {
                    throw new LeaseLostException();
                }
            } catch (LeaseLostException e) {
                throw e;
            } catch (RuntimeException e) {
                throw new UnavailableException();
            }
        }

        @Override
        public void close() {
            if (!closed.compareAndSet(false, true)) {
                return;
            }
            try {
                redis.execute(RELEASE, List.of(LEASE_PREFIX + userId), owner);
            } catch (RuntimeException ignored) {
                // The bounded lease expires; node admission is always released locally.
            } finally {
                nodePermits.release();
            }
        }
    }

    public static class BusyException extends RuntimeException {
        public BusyException() {
            super("Mail connection check is busy");
        }
    }

    public static class UnavailableException extends RuntimeException {
        public UnavailableException() {
            super("Mail connection check admission is unavailable");
        }
    }

    public static class LeaseLostException extends RuntimeException {
        public LeaseLostException() {
            super("Mail connection check user lease lost");
        }
    }
}
