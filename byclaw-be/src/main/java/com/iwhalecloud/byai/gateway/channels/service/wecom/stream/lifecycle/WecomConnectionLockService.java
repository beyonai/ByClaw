package com.iwhalecloud.byai.gateway.channels.service.wecom.stream.lifecycle;

import com.iwhalecloud.byai.common.util.RedisUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Redis single-active lock for WeCom connections (plan §Task 9, §12). Each bot
 * may hold at most one active long connection across all instances; without
 * this, instances kick each other offline in a loop.
 *
 * <p>Uses an owner/fencing token per bot: acquire stores the token, renew is
 * CAS (refresh TTL only if still owner), release is CAS delete (never an
 * unconditional DEL that could wipe a new owner's lock). Backed by
 * {@code RedisUtil.lock/renewLock/releaseLock}.
 */
@Service
public class WecomConnectionLockService {

    private static final Logger logger = LoggerFactory.getLogger(WecomConnectionLockService.class);
    private static final String LOCK_KEY_PREFIX = "wecom:connection:lock:";
    /** Lock TTL (seconds); renew well within this. */
    private static final long LOCK_TTL_SECONDS = 90L;

    /** botId -> our fencing token, for the locks this instance believes it holds. */
    private final java.util.Map<String, String> ownedTokens = new ConcurrentHashMap<>();

    public long lockTtlSeconds() {
        return LOCK_TTL_SECONDS;
    }

    /** Try to acquire the single-active lock for a bot. Returns true if we now own it. */
    public boolean acquire(String botId) {
        String token = UUID.randomUUID().toString();
        Boolean ok = RedisUtil.lock(lockKey(botId), token, LOCK_TTL_SECONDS);
        if (Boolean.TRUE.equals(ok)) {
            ownedTokens.put(botId, token);
            return true;
        }
        return false;
    }

    /** Renew only if still owner (CAS). Returns false if the lock is no longer ours. */
    public boolean renew(String botId) {
        String token = ownedTokens.get(botId);
        if (token == null) {
            return false;
        }
        boolean renewed = Boolean.TRUE.equals(RedisUtil.renewLock(lockKey(botId), token, LOCK_TTL_SECONDS));
        if (!renewed) {
            ownedTokens.remove(botId);
            logger.warn("WeCom connection lock lost on renew. botId masked");
        }
        return renewed;
    }

    /** True if this instance currently believes it owns the bot's lock. */
    public boolean isOwner(String botId) {
        return ownedTokens.containsKey(botId);
    }

    /** Release the lock (CAS delete) if we own it. */
    public void release(String botId) {
        String token = ownedTokens.remove(botId);
        if (token != null) {
            RedisUtil.releaseLock(lockKey(botId), token);
        }
    }

    private String lockKey(String botId) {
        return LOCK_KEY_PREFIX + botId;
    }
}
