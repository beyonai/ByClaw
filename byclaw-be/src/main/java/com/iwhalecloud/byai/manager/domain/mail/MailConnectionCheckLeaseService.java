package com.iwhalecloud.byai.manager.domain.mail;

import java.time.Duration;
import java.util.Collections;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Service;

/** Cross-instance bounded lease for one mail account connection check. */
@Service
public class MailConnectionCheckLeaseService {

    private static final Duration TTL = Duration.ofSeconds(60);
    private static final String PREFIX = "byai:mail:connection-check:";
    private static final DefaultRedisScript<Long> RELEASE = new DefaultRedisScript<>(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        Long.class);
    private static final DefaultRedisScript<Long> RENEW = new DefaultRedisScript<>(
        "if redis.call('get', KEYS[1]) == ARGV[1] then "
            + "return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end",
        Long.class);

    private final StringRedisTemplate redis;

    public MailConnectionCheckLeaseService(StringRedisTemplate redis) {
        this.redis = redis;
    }

    public Optional<Lease> tryAcquire(Long accountId) {
        if (accountId == null) {
            return Optional.empty();
        }
        try {
            String owner = UUID.randomUUID().toString();
            Boolean acquired = redis.opsForValue().setIfAbsent(PREFIX + accountId, owner, TTL);
            return Boolean.TRUE.equals(acquired) ? Optional.of(new Lease(accountId, owner)) : Optional.empty();
        } catch (RuntimeException e) {
            throw new LeaseUnavailableException();
        }
    }

    public boolean release(Lease lease) {
        if (lease == null) {
            return false;
        }
        try {
            Long released = redis.execute(RELEASE, Collections.singletonList(PREFIX + lease.accountId()), lease.owner());
            return released != null && released > 0;
        } catch (RuntimeException e) {
            return false;
        }
    }

    public void assertOwnedAndRenew(Lease lease) {
        if (lease == null) {
            throw new LeaseLostException();
        }
        try {
            Long renewed = redis.execute(RENEW, Collections.singletonList(PREFIX + lease.accountId()),
                lease.owner(), Long.toString(TTL.toMillis()));
            if (renewed == null || renewed == 0L) {
                throw new LeaseLostException();
            }
        } catch (LeaseLostException e) {
            throw e;
        } catch (RuntimeException e) {
            throw new LeaseUnavailableException();
        }
    }

    public record Lease(Long accountId, String owner) { }

    public static class LeaseUnavailableException extends RuntimeException {
        public LeaseUnavailableException() {
            super("Mail connection check lease unavailable");
        }
    }

    public static class LeaseLostException extends RuntimeException {
        public LeaseLostException() {
            super("Mail connection check lease lost");
        }
    }
}
