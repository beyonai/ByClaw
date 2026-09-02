package com.iwhalecloud.byai.manager.domain.connector.authorization;

import java.time.Duration;
import java.util.Date;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;

@Component
public class RedisAuthorizationSessionRepository {

    private static final String SESSION_KEY_PREFIX = "connector:authorization:{auth}:session:";
    private static final String USER_INDEX_KEY_PREFIX = "connector:authorization:{auth}:user:";
    private static final String STATUS_LOCK_KEY_PREFIX = "connector:authorization:{auth}:status-lock:";
    private static final String START_LOCK_KEY_PREFIX = "connector:authorization:{auth}:start-lock:";

    private static final String CREATE_LUA = """
        local ttlMillis = tonumber(ARGV[3])
        if not ttlMillis or ttlMillis <= 0 then
            return 0
        end
        local createsActiveIndex = ARGV[4] == 'PENDING' or ARGV[4] == 'FINALIZING'
        if redis.call('EXISTS', KEYS[1]) == 1
            or createsActiveIndex and redis.call('EXISTS', KEYS[2]) == 1 then
            return 0
        end
        redis.call('SET', KEYS[1], ARGV[1], 'PX', ttlMillis)
        if createsActiveIndex then
            redis.call('SET', KEYS[2], ARGV[2], 'PX', ttlMillis)
        end
        return 1
        """;

    private static final String COMPARE_AND_SET_STATUS_LUA = """
        local currentJson = redis.call('GET', KEYS[1])
        if not currentJson then
            return 0
        end
        local currentOk, current = pcall(cjson.decode, currentJson)
        if not currentOk or type(current) ~= 'table' then
            return 0
        end
        if current.status == nil or current.version == nil or current.expiresAt == nil then
            return 0
        end
        local expectedIndexKey = ARGV[4] .. tostring(current.userId) .. ':' .. tostring(current.connectorId)
        if KEYS[2] ~= expectedIndexKey then
            return 0
        end
        if current.status ~= ARGV[1] or tonumber(current.version) ~= tonumber(ARGV[2]) then
            return 0
        end
        if current.status == 'CONNECTED' or current.status == 'FAILED'
            or current.status == 'EXPIRED' or current.status == 'CANCELLED' then
            return 0
        end
        local pttl = redis.call('PTTL', KEYS[1])
        if pttl <= 0 then
            return 0
        end
        local redisTime = redis.call('TIME')
        local redisNowMillis = tonumber(redisTime[1]) * 1000 + math.floor(tonumber(redisTime[2]) / 1000)
        if tonumber(current.expiresAt) <= redisNowMillis then
            return 0
        end
        local replacementOk, replacement = pcall(cjson.decode, ARGV[3])
        if not replacementOk or type(replacement) ~= 'table' or replacement.status == nil then
            return 0
        end
        replacement.authorizationId = current.authorizationId
        replacement.userId = current.userId
        replacement.connectorId = current.connectorId
        replacement.connectorCode = current.connectorCode
        replacement.providerCode = current.providerCode
        replacement.providerSessionId = current.providerSessionId
        local replacementPttl = pttl
        if current.status == 'PENDING' and replacement.status == 'PENDING' then
            if redis.call('GET', KEYS[2]) ~= current.authorizationId then
                return 0
            end
            local replacementExpiresAt = tonumber(replacement.expiresAt)
            if not replacementExpiresAt or replacementExpiresAt <= redisNowMillis then
                return 0
            end
            replacement.expiresAt = replacementExpiresAt
            replacementPttl = replacementExpiresAt - redisNowMillis
        else
            replacement.expiresAt = current.expiresAt
        end
        replacement.version = tonumber(current.version) + 1
        local releasesActiveIndex = replacement.status == 'CONNECTED'
            or replacement.status == 'FAILED'
            or replacement.status == 'EXPIRED'
            or replacement.status == 'CANCELLED'
        redis.call('SET', KEYS[1], cjson.encode(replacement))
        redis.call('PEXPIRE', KEYS[1], replacementPttl)
        if not releasesActiveIndex then
            redis.call('PEXPIRE', KEYS[2], replacementPttl)
        end
        if releasesActiveIndex then
            local indexedAuthorizationId = redis.call('GET', KEYS[2])
            if indexedAuthorizationId == current.authorizationId then
                redis.call('DEL', KEYS[2])
            end
        end
        return 1
        """;

    private static final String DELETE_SECRETS_LUA = """
        local currentJson = redis.call('GET', KEYS[1])
        if not currentJson then
            return 0
        end
        local currentOk, current = pcall(cjson.decode, currentJson)
        if not currentOk or type(current) ~= 'table' or current.version == nil or current.expiresAt == nil then
            return 0
        end
        local pttl = redis.call('PTTL', KEYS[1])
        if pttl <= 0 then
            return 0
        end
        local redisTime = redis.call('TIME')
        local redisNowMillis = tonumber(redisTime[1]) * 1000 + math.floor(tonumber(redisTime[2]) / 1000)
        if tonumber(current.expiresAt) <= redisNowMillis then
            return 0
        end
        current.authorizationUrlCipher = cjson.null
        current.providerStateCipher = cjson.null
        current.version = tonumber(current.version) + 1
        redis.call('SET', KEYS[1], cjson.encode(current))
        redis.call('PEXPIRE', KEYS[1], pttl)
        return 1
        """;

    private static final String REMOVE_EXPIRED_LUA = """
        local indexedAuthorizationId = redis.call('GET', KEYS[2])
        if indexedAuthorizationId == ARGV[1] then
            redis.call('DEL', KEYS[2])
        end
        return redis.call('DEL', KEYS[1])
        """;

    private static final String RELEASE_STATUS_LOCK_LUA = """
        if redis.call('GET', KEYS[1]) == ARGV[1] then
            return redis.call('DEL', KEYS[1])
        end
        return 0
        """;

    private static final String REMOVE_ACTIVE_INDEX_IF_MATCHES_LUA = """
        if redis.call('GET', KEYS[1]) == ARGV[1] then
            return redis.call('DEL', KEYS[1])
        end
        return 0
        """;

    private static final RedisScript<Long> CREATE_SCRIPT = new DefaultRedisScript<>(CREATE_LUA, Long.class);
    private static final RedisScript<Long> COMPARE_AND_SET_STATUS_SCRIPT =
        new DefaultRedisScript<>(COMPARE_AND_SET_STATUS_LUA, Long.class);
    private static final RedisScript<Long> DELETE_SECRETS_SCRIPT =
        new DefaultRedisScript<>(DELETE_SECRETS_LUA, Long.class);
    private static final RedisScript<Long> REMOVE_EXPIRED_SCRIPT =
        new DefaultRedisScript<>(REMOVE_EXPIRED_LUA, Long.class);
    private static final RedisScript<Long> RELEASE_STATUS_LOCK_SCRIPT =
        new DefaultRedisScript<>(RELEASE_STATUS_LOCK_LUA, Long.class);
    private static final RedisScript<Long> REMOVE_ACTIVE_INDEX_IF_MATCHES_SCRIPT =
        new DefaultRedisScript<>(REMOVE_ACTIVE_INDEX_IF_MATCHES_LUA, Long.class);

    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;

    public RedisAuthorizationSessionRepository(StringRedisTemplate redisTemplate, ObjectMapper objectMapper) {
        this.redisTemplate = redisTemplate;
        this.objectMapper = objectMapper;
    }

    public void create(RedisAuthorizationSession session) {
        validateForCreate(session);
        String sessionJson = serialize(session);
        long remainingMillis = session.expiresAt().getTime() - System.currentTimeMillis();
        if (remainingMillis <= 0) {
            throw new IllegalArgumentException("Authorization session must not already be expired");
        }
        Long result = redisTemplate.execute(
            CREATE_SCRIPT,
            List.of(sessionKey(session.authorizationId()), userIndexKey(session.userId(), session.connectorId())),
            sessionJson,
            session.authorizationId(),
            Long.toString(remainingMillis),
            session.status().name());
        if (!Long.valueOf(1L).equals(result)) {
            throw new IllegalStateException("Could not create authorization session because a session is already active");
        }
    }

    public Optional<RedisAuthorizationSession> find(String authorizationId) {
        if (!StringUtils.hasText(authorizationId)) {
            return Optional.empty();
        }
        String value = redisTemplate.opsForValue().get(sessionKey(authorizationId));
        if (!StringUtils.hasText(value)) {
            return Optional.empty();
        }

        RedisAuthorizationSession session;
        try {
            session = objectMapper.readValue(value, RedisAuthorizationSession.class);
        } catch (JsonProcessingException e) {
            return Optional.empty();
        }
        if (session.expiresAt() == null || session.expiresAt().getTime() <= System.currentTimeMillis()) {
            removeExpired(authorizationId, session);
            return Optional.empty();
        }
        return Optional.of(session);
    }

    public Optional<RedisAuthorizationSession> findOwned(String authorizationId, String userId) {
        if (!StringUtils.hasText(userId)) {
            return Optional.empty();
        }
        return find(authorizationId).filter(session -> userId.equals(session.userId()));
    }

    public Optional<RedisAuthorizationSession> findActiveSession(String userId, Long connectorId) {
        if (!StringUtils.hasText(userId) || connectorId == null) {
            return Optional.empty();
        }
        String indexKey = userIndexKey(userId, connectorId);
        String authorizationId = redisTemplate.opsForValue().get(indexKey);
        if (!StringUtils.hasText(authorizationId)) {
            return Optional.empty();
        }
        Optional<RedisAuthorizationSession> activeSession = find(authorizationId)
            .filter(session -> userId.equals(session.userId()))
            .filter(session -> connectorId.equals(session.connectorId()))
            .filter(session -> session.status() == AuthorizationStatus.PENDING
                || session.status() == AuthorizationStatus.FINALIZING);
        if (activeSession.isPresent()) {
            return activeSession;
        }
        redisTemplate.execute(
            REMOVE_ACTIVE_INDEX_IF_MATCHES_SCRIPT,
            List.of(indexKey),
            authorizationId);
        return Optional.empty();
    }

    public boolean hasActiveSession(String userId, Long connectorId) {
        if (!StringUtils.hasText(userId) || connectorId == null) {
            return false;
        }
        return StringUtils.hasText(redisTemplate.opsForValue().get(userIndexKey(userId, connectorId)));
    }

    public boolean compareAndSetStatus(
            String authorizationId,
            AuthorizationStatus expectedStatus,
            long expectedVersion,
            RedisAuthorizationSession replacement) {
        if (!StringUtils.hasText(authorizationId) || expectedStatus == null || replacement == null) {
            return false;
        }
        Long result = redisTemplate.execute(
            COMPARE_AND_SET_STATUS_SCRIPT,
            List.of(
                sessionKey(authorizationId),
                userIndexKey(replacement.userId(), replacement.connectorId())),
            expectedStatus.name(),
            Long.toString(expectedVersion),
            serialize(replacement),
            USER_INDEX_KEY_PREFIX);
        return Long.valueOf(1L).equals(result);
    }

    public boolean deleteSecrets(String authorizationId) {
        if (!StringUtils.hasText(authorizationId)) {
            return false;
        }
        Long result = redisTemplate.execute(DELETE_SECRETS_SCRIPT, List.of(sessionKey(authorizationId)));
        return Long.valueOf(1L).equals(result);
    }

    public Optional<String> tryAcquireStatusLock(String authorizationId, Duration ttl) {
        if (!StringUtils.hasText(authorizationId)) {
            return Optional.empty();
        }
        return tryAcquireLock(statusLockKey(authorizationId), ttl);
    }

    public void releaseStatusLock(String authorizationId, String token) {
        if (!StringUtils.hasText(authorizationId) || !StringUtils.hasText(token)) {
            return;
        }
        redisTemplate.execute(
            RELEASE_STATUS_LOCK_SCRIPT,
            List.of(statusLockKey(authorizationId)),
            token
        );
    }

    public Optional<String> tryAcquireStartLock(String userId, Long connectorId, Duration ttl) {
        if (!StringUtils.hasText(userId) || connectorId == null) {
            return Optional.empty();
        }
        return tryAcquireLock(startLockKey(userId, connectorId), ttl);
    }

    public void releaseStartLock(String userId, Long connectorId, String token) {
        if (!StringUtils.hasText(userId) || connectorId == null || !StringUtils.hasText(token)) {
            return;
        }
        redisTemplate.execute(
            RELEASE_STATUS_LOCK_SCRIPT,
            List.of(startLockKey(userId, connectorId)),
            token
        );
    }

    private Optional<String> tryAcquireLock(String key, Duration ttl) {
        if (!StringUtils.hasText(key) || ttl == null || ttl.isZero() || ttl.isNegative()) {
            return Optional.empty();
        }
        String token = UUID.randomUUID().toString();
        Boolean acquired = redisTemplate.opsForValue().setIfAbsent(key, token, ttl);
        return Boolean.TRUE.equals(acquired) ? Optional.of(token) : Optional.empty();
    }

    private void validateForCreate(RedisAuthorizationSession session) {
        if (session == null
                || !StringUtils.hasText(session.authorizationId())
                || !StringUtils.hasText(session.userId())
                || session.connectorId() == null
                || !StringUtils.hasText(session.connectorCode())
                || !StringUtils.hasText(session.providerCode())
                || session.status() == null
                || session.expiresAt() == null) {
            throw new IllegalArgumentException("Authorization session identity, status, and expiry are required");
        }
    }

    private String serialize(RedisAuthorizationSession session) {
        try {
            return objectMapper.writeValueAsString(session);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Could not serialize authorization session", e);
        }
    }

    private void removeExpired(String authorizationId, RedisAuthorizationSession session) {
        if (StringUtils.hasText(session.userId()) && session.connectorId() != null) {
            redisTemplate.execute(
                REMOVE_EXPIRED_SCRIPT,
                List.of(sessionKey(authorizationId), userIndexKey(session.userId(), session.connectorId())),
                authorizationId);
            return;
        }
        redisTemplate.delete(sessionKey(authorizationId));
    }

    private String sessionKey(String authorizationId) {
        return SESSION_KEY_PREFIX + authorizationId;
    }

    private String statusLockKey(String authorizationId) {
        return STATUS_LOCK_KEY_PREFIX + authorizationId;
    }

    private String startLockKey(String userId, Long connectorId) {
        return START_LOCK_KEY_PREFIX + userId + ":" + connectorId;
    }

    private String userIndexKey(String userId, Long connectorId) {
        return USER_INDEX_KEY_PREFIX + userId + ":" + connectorId;
    }
}
