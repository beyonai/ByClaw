package com.iwhalecloud.byai.manager.domain.connector.authorization;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.text.SimpleDateFormat;
import java.time.Duration;
import java.util.Date;
import java.util.List;
import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.data.redis.core.script.RedisScript;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;

@ExtendWith(MockitoExtension.class)
class RedisAuthorizationSessionRepositoryTest {

    private static final String AUTHORIZATION_ID = "authorization-1";
    private static final String USER_ID = "user-1";
    private static final Long CONNECTOR_ID = 42L;
    private static final String USER_INDEX_KEY_PREFIX = "connector:authorization:{auth}:user:";
    private static final String SESSION_KEY = "connector:authorization:{auth}:session:" + AUTHORIZATION_ID;
    private static final String USER_INDEX_KEY = USER_INDEX_KEY_PREFIX + USER_ID + ":" + CONNECTOR_ID;
    private static final String STATUS_LOCK_KEY = "connector:authorization:{auth}:status-lock:" + AUTHORIZATION_ID;
    private static final String START_LOCK_KEY =
        "connector:authorization:{auth}:start-lock:" + USER_ID + ":" + CONNECTOR_ID;

    @Mock
    private StringRedisTemplate redisTemplate;

    @Mock
    private ValueOperations<String, String> valueOperations;

    private ObjectMapper objectMapper;
    private RedisAuthorizationSessionRepository repository;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        objectMapper.setDateFormat(new SimpleDateFormat("yyyy-MM-dd HH:mm:ss"));
        objectMapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        repository = new RedisAuthorizationSessionRepository(redisTemplate, objectMapper);
        lenient().when(redisTemplate.opsForValue()).thenReturn(valueOperations);
    }

    @Test
    @SuppressWarnings({"rawtypes", "unchecked"})
    void createAtomicallyStoresSessionAndActiveIndexWithExactPositiveTtlMillis() throws Exception {
        long beforeCreate = System.currentTimeMillis();
        RedisAuthorizationSession session = session(AuthorizationStatus.PENDING, new Date(beforeCreate + 600_123L), 0L);
        ArgumentCaptor<RedisScript> scriptCaptor = ArgumentCaptor.forClass(RedisScript.class);
        ArgumentCaptor<String> jsonCaptor = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> ttlMillisCaptor = ArgumentCaptor.forClass(String.class);
        when(redisTemplate.execute(
            any(RedisScript.class),
            eq(List.of(SESSION_KEY, USER_INDEX_KEY)),
            anyString(),
            eq(AUTHORIZATION_ID),
            anyString(),
            eq("PENDING"))).thenReturn(1L);

        repository.create(session);
        long afterCreate = System.currentTimeMillis();

        verify(redisTemplate).execute(
            scriptCaptor.capture(),
            eq(List.of(SESSION_KEY, USER_INDEX_KEY)),
            jsonCaptor.capture(),
            eq(AUTHORIZATION_ID),
            ttlMillisCaptor.capture(),
            eq("PENDING"));
        long ttlMillis = Long.parseLong(ttlMillisCaptor.getValue());
        assertThat(ttlMillis).isPositive();
        assertThat(session.expiresAt().getTime() - ttlMillis).isBetween(beforeCreate, afterCreate);
        assertThat(objectMapper.readValue(jsonCaptor.getValue(), RedisAuthorizationSession.class)).isEqualTo(session);
        JsonNode serialized = objectMapper.readTree(jsonCaptor.getValue());
        assertThat(serialized.path("expiresAt").isNumber()).isTrue();
        assertThat(serialized.path("expiresAt").longValue()).isEqualTo(session.expiresAt().getTime());
        assertThat(redisHashTag(SESSION_KEY)).isEqualTo("auth");
        assertThat(redisHashTag(USER_INDEX_KEY)).isEqualTo(redisHashTag(SESSION_KEY));
        assertThat(scriptCaptor.getValue().getScriptAsString())
            .contains(
                "redis.call('EXISTS', KEYS[1]) == 1",
                "local createsActiveIndex = ARGV[4] == 'PENDING' or ARGV[4] == 'FINALIZING'",
                "createsActiveIndex and redis.call('EXISTS', KEYS[2]) == 1",
                "redis.call('SET', KEYS[1], ARGV[1], 'PX', ttlMillis)",
                "if createsActiveIndex then",
                "redis.call('SET', KEYS[2], ARGV[2], 'PX', ttlMillis)",
                "return 1");
        verify(valueOperations, never()).set(anyString(), anyString(), any(Duration.class));
    }

    @Test
    void activeSessionCheckReadsTheUserConnectorIndex() {
        when(valueOperations.get(USER_INDEX_KEY)).thenReturn(AUTHORIZATION_ID, null);

        assertThat(repository.hasActiveSession(USER_ID, CONNECTOR_ID)).isTrue();
        assertThat(repository.hasActiveSession(USER_ID, CONNECTOR_ID)).isFalse();

        verify(valueOperations, times(2)).get(USER_INDEX_KEY);
    }

    @Test
    @SuppressWarnings({"rawtypes", "unchecked"})
    void statusTransitionLockUsesUniqueTokenTtlAndCompareDeleteRelease() {
        Duration ttl = Duration.ofSeconds(90);
        when(valueOperations.setIfAbsent(eq(STATUS_LOCK_KEY), anyString(), eq(ttl))).thenReturn(true);
        when(redisTemplate.execute(
            any(RedisScript.class),
            eq(List.of(STATUS_LOCK_KEY)),
            anyString())).thenReturn(1L);

        Optional<String> token = repository.tryAcquireStatusLock(AUTHORIZATION_ID, ttl);
        repository.releaseStatusLock(AUTHORIZATION_ID, token.orElseThrow());

        ArgumentCaptor<String> tokenCaptor = ArgumentCaptor.forClass(String.class);
        verify(valueOperations).setIfAbsent(eq(STATUS_LOCK_KEY), tokenCaptor.capture(), eq(ttl));
        verify(redisTemplate).execute(
            any(RedisScript.class),
            eq(List.of(STATUS_LOCK_KEY)),
            eq(tokenCaptor.getValue()));
        assertThat(tokenCaptor.getValue()).isNotBlank();
    }

    @Test
    @SuppressWarnings({"rawtypes", "unchecked"})
    void startLockIsScopedByUserAndConnectorAndUsesCompareDeleteRelease() {
        Duration ttl = Duration.ofMinutes(2);
        when(valueOperations.setIfAbsent(eq(START_LOCK_KEY), anyString(), eq(ttl))).thenReturn(true);
        when(redisTemplate.execute(
            any(RedisScript.class),
            eq(List.of(START_LOCK_KEY)),
            anyString())).thenReturn(1L);

        String token = repository.tryAcquireStartLock(USER_ID, CONNECTOR_ID, ttl).orElseThrow();
        repository.releaseStartLock(USER_ID, CONNECTOR_ID, token);

        verify(valueOperations).setIfAbsent(START_LOCK_KEY, token, ttl);
        verify(redisTemplate).execute(any(RedisScript.class), eq(List.of(START_LOCK_KEY)), eq(token));
    }

    @Test
    @SuppressWarnings({"rawtypes", "unchecked"})
    void createThrowsWhenSessionOrActiveIndexAlreadyExists() {
        RedisAuthorizationSession session = session(AuthorizationStatus.PENDING, futureExpiry(), 0L);
        when(redisTemplate.execute(
            any(RedisScript.class),
            eq(List.of(SESSION_KEY, USER_INDEX_KEY)),
            anyString(),
            eq(AUTHORIZATION_ID),
            anyString(),
            eq("PENDING"))).thenReturn(0L);

        assertThatThrownBy(() -> repository.create(session))
            .isInstanceOf(IllegalStateException.class);
    }

    @Test
    @SuppressWarnings({"rawtypes", "unchecked"})
    void createTerminalSessionDoesNotClaimActiveUserIndex() {
        RedisAuthorizationSession session = session(AuthorizationStatus.FAILED, futureExpiry(), 0L);
        ArgumentCaptor<RedisScript> scriptCaptor = ArgumentCaptor.forClass(RedisScript.class);
        when(redisTemplate.execute(
            any(RedisScript.class),
            eq(List.of(SESSION_KEY, USER_INDEX_KEY)),
            anyString(),
            eq(AUTHORIZATION_ID),
            anyString(),
            eq("FAILED"))).thenReturn(1L);

        repository.create(session);

        verify(redisTemplate).execute(
            scriptCaptor.capture(),
            eq(List.of(SESSION_KEY, USER_INDEX_KEY)),
            anyString(),
            eq(AUTHORIZATION_ID),
            anyString(),
            eq("FAILED"));
        String script = scriptCaptor.getValue().getScriptAsString();
        assertThat(script)
            .contains(
                "local createsActiveIndex = ARGV[4] == 'PENDING' or ARGV[4] == 'FINALIZING'",
                "if createsActiveIndex then",
                "redis.call('SET', KEYS[2], ARGV[2], 'PX', ttlMillis)")
            .doesNotContain("redis.call('SET', KEYS[2], ARGV[2], 'PX', ttlMillis)\n        return 1");
    }

    @Test
    void createValidatesRequiredIdentityStatusAndExpiry() {
        RedisAuthorizationSession valid = session(AuthorizationStatus.PENDING, futureExpiry(), 0L);

        assertThatThrownBy(() -> repository.create(copy(valid, " ", USER_ID, CONNECTOR_ID, "connector", "provider",
            AuthorizationStatus.PENDING, valid.expiresAt())))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> repository.create(copy(valid, AUTHORIZATION_ID, "", CONNECTOR_ID, "connector", "provider",
            AuthorizationStatus.PENDING, valid.expiresAt())))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> repository.create(copy(valid, AUTHORIZATION_ID, USER_ID, null, "connector", "provider",
            AuthorizationStatus.PENDING, valid.expiresAt())))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> repository.create(copy(valid, AUTHORIZATION_ID, USER_ID, CONNECTOR_ID, " ", "provider",
            AuthorizationStatus.PENDING, valid.expiresAt())))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> repository.create(copy(valid, AUTHORIZATION_ID, USER_ID, CONNECTOR_ID, "connector", null,
            AuthorizationStatus.PENDING, valid.expiresAt())))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> repository.create(copy(valid, AUTHORIZATION_ID, USER_ID, CONNECTOR_ID, "connector", "provider",
            null, valid.expiresAt())))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> repository.create(copy(valid, AUTHORIZATION_ID, USER_ID, CONNECTOR_ID, "connector", "provider",
            AuthorizationStatus.PENDING, null)))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> repository.create(copy(valid, AUTHORIZATION_ID, USER_ID, CONNECTOR_ID, "connector", "provider",
            AuthorizationStatus.PENDING, new Date(System.currentTimeMillis() - 1))))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void findOwnedRejectsAnotherUser() throws Exception {
        when(valueOperations.get(SESSION_KEY)).thenReturn(objectMapper.writeValueAsString(
            session(AuthorizationStatus.PENDING, futureExpiry(), 0L)));

        assertThat(repository.findOwned(AUTHORIZATION_ID, "other-user")).isEmpty();
    }

    @Test
    void findReturnsEmptyForBlankAndMissingKeys() {
        when(valueOperations.get(SESSION_KEY)).thenReturn(null);

        assertThat(repository.find(" ")).isEmpty();
        assertThat(repository.find(AUTHORIZATION_ID)).isEmpty();
        verify(valueOperations, never()).get("connector:authorization: ");
    }

    @Test
    @SuppressWarnings({"rawtypes", "unchecked"})
    void findAtomicallyRemovesExpiredSessionAndOnlyItsMatchingActiveIndex() throws Exception {
        when(valueOperations.get(SESSION_KEY)).thenReturn(objectMapper.writeValueAsString(
            session(AuthorizationStatus.PENDING, new Date(System.currentTimeMillis() - 1), 0L)));
        ArgumentCaptor<RedisScript> scriptCaptor = ArgumentCaptor.forClass(RedisScript.class);

        assertThat(repository.find(AUTHORIZATION_ID)).isEmpty();
        verify(redisTemplate).execute(
            scriptCaptor.capture(), eq(List.of(SESSION_KEY, USER_INDEX_KEY)), eq(AUTHORIZATION_ID));
        String script = scriptCaptor.getValue().getScriptAsString();
        assertThat(script)
            .contains(
                "local indexedAuthorizationId = redis.call('GET', KEYS[2])",
                "if indexedAuthorizationId == ARGV[1] then",
                "redis.call('DEL', KEYS[2])",
                "return redis.call('DEL', KEYS[1])");
    }

    @Test
    void findDecodesTerminalJson() throws Exception {
        RedisAuthorizationSession terminal = session(AuthorizationStatus.CONNECTED, futureExpiry(), 9L);
        when(valueOperations.get(SESSION_KEY)).thenReturn(objectMapper.writeValueAsString(terminal));

        assertThat(repository.find(AUTHORIZATION_ID)).contains(terminal);
    }

    @Test
    void findReturnsEmptyForMalformedJson() {
        when(valueOperations.get(SESSION_KEY)).thenReturn("{not-json");

        assertThat(repository.find(AUTHORIZATION_ID)).isEmpty();
    }

    @Test
    @SuppressWarnings({"rawtypes", "unchecked"})
    void compareAndSetStatusPreservesImmutableFieldsAndUsesRedisTimeForLogicalExpiry() throws Exception {
        RedisAuthorizationSession replacement = session(AuthorizationStatus.FINALIZING, futureExpiry(), 99L);
        ArgumentCaptor<RedisScript> scriptCaptor = ArgumentCaptor.forClass(RedisScript.class);
        ArgumentCaptor<String> replacementCaptor = ArgumentCaptor.forClass(String.class);
        when(redisTemplate.execute(
            any(RedisScript.class),
            eq(List.of(SESSION_KEY, USER_INDEX_KEY)),
            eq("PENDING"),
            eq("7"),
            anyString(),
            eq(USER_INDEX_KEY_PREFIX))).thenReturn(1L, 0L);

        assertThat(repository.compareAndSetStatus(
            AUTHORIZATION_ID, AuthorizationStatus.PENDING, 7L, replacement)).isTrue();
        assertThat(repository.compareAndSetStatus(
            AUTHORIZATION_ID, AuthorizationStatus.PENDING, 7L, replacement)).isFalse();

        verify(redisTemplate, times(2)).execute(
            scriptCaptor.capture(),
            eq(List.of(SESSION_KEY, USER_INDEX_KEY)),
            eq("PENDING"),
            eq("7"),
            replacementCaptor.capture(),
            eq(USER_INDEX_KEY_PREFIX));
        String script = scriptCaptor.getValue().getScriptAsString();
        assertThat(script)
            .contains("GET", "cjson.decode", "CONNECTED", "FAILED", "EXPIRED", "CANCELLED")
            .contains("PTTL", "TIME", "redisNowMillis", "current.expiresAt", "PEXPIRE")
            .contains(
                "replacement.authorizationId = current.authorizationId",
                "replacement.userId = current.userId",
                "replacement.connectorId = current.connectorId",
                "replacement.connectorCode = current.connectorCode",
                "replacement.providerCode = current.providerCode",
                "replacement.providerSessionId = current.providerSessionId",
                "replacement.expiresAt = current.expiresAt",
                "replacement.version = tonumber(current.version) + 1")
            .doesNotContain(
                "replacement.status = current.status",
                "replacement.errorCode = current.errorCode",
                "replacement.errorMessage = current.errorMessage",
                "replacement.authorizationUrlCipher = current.authorizationUrlCipher",
                "replacement.providerStateCipher = current.providerStateCipher",
                "replacement.ownerInstanceId = current.ownerInstanceId");
        assertThat(script).contains("tonumber(current.expiresAt) <= redisNowMillis");
        assertThat(objectMapper.readTree(replacementCaptor.getValue()).path("expiresAt").isNumber()).isTrue();
    }

    @Test
    @SuppressWarnings({"rawtypes", "unchecked"})
    void compareAndSetStatusValidatesCurrentActiveIndexAndReleasesItOnlyForTerminalReplacement() {
        RedisAuthorizationSession replacement = session(AuthorizationStatus.CONNECTED, futureExpiry(), 8L);
        ArgumentCaptor<RedisScript> scriptCaptor = ArgumentCaptor.forClass(RedisScript.class);
        when(redisTemplate.execute(
            any(RedisScript.class),
            eq(List.of(SESSION_KEY, USER_INDEX_KEY)),
            eq("FINALIZING"),
            eq("8"),
            anyString(),
            eq(USER_INDEX_KEY_PREFIX))).thenReturn(1L);

        assertThat(repository.compareAndSetStatus(
            AUTHORIZATION_ID, AuthorizationStatus.FINALIZING, 8L, replacement)).isTrue();

        verify(redisTemplate).execute(
            scriptCaptor.capture(),
            eq(List.of(SESSION_KEY, USER_INDEX_KEY)),
            eq("FINALIZING"),
            eq("8"),
            anyString(),
            eq(USER_INDEX_KEY_PREFIX));
        String script = scriptCaptor.getValue().getScriptAsString();
        assertThat(script)
            .contains(
                "local expectedIndexKey = ARGV[4] .. tostring(current.userId) .. ':' .. tostring(current.connectorId)",
                "if KEYS[2] ~= expectedIndexKey then",
                "local releasesActiveIndex = replacement.status == 'CONNECTED'",
                "or replacement.status == 'FAILED'",
                "or replacement.status == 'EXPIRED'",
                "or replacement.status == 'CANCELLED'",
                "local indexedAuthorizationId = redis.call('GET', KEYS[2])",
                "if indexedAuthorizationId == current.authorizationId then",
                "redis.call('DEL', KEYS[2])")
            .doesNotContain(
                "or replacement.status == 'PENDING'",
                "or replacement.status == 'FINALIZING'");
        assertThat(script).contains(
            "if current.status == 'PENDING' and replacement.status == 'PENDING' then",
            "if redis.call('GET', KEYS[2]) ~= current.authorizationId then",
            "replacementPttl = replacementExpiresAt - redisNowMillis",
            "redis.call('PEXPIRE', KEYS[2], replacementPttl)");
        int keyGuard = script.indexOf("if KEYS[2] ~= expectedIndexKey then");
        assertThat(keyGuard).isNotNegative();
        assertThat(keyGuard).isLessThan(script.indexOf("redis.call('SET', KEYS[1]"));
        assertThat(keyGuard).isLessThan(script.indexOf("redis.call('DEL', KEYS[2]"));
    }

    @Test
    @SuppressWarnings({"rawtypes", "unchecked"})
    void deleteSecretsExecutesAtomicallyAndReturnsFalseForMissingOrExpiredSession() {
        ArgumentCaptor<RedisScript> scriptCaptor = ArgumentCaptor.forClass(RedisScript.class);
        when(redisTemplate.execute(any(RedisScript.class), eq(List.of(SESSION_KEY))))
            .thenReturn(1L, 0L);

        assertThat(repository.deleteSecrets(AUTHORIZATION_ID)).isTrue();
        assertThat(repository.deleteSecrets(AUTHORIZATION_ID)).isFalse();

        verify(redisTemplate, org.mockito.Mockito.times(2)).execute(scriptCaptor.capture(), eq(List.of(SESSION_KEY)));
        assertThat(scriptCaptor.getValue().getScriptAsString())
            .contains("GET", "cjson.decode", "authorizationUrlCipher", "providerStateCipher")
            .contains("cjson.null", "PTTL", "TIME", "redisNowMillis", "current.expiresAt", "version", "PEXPIRE")
            .contains("tonumber(current.expiresAt) <= redisNowMillis");
    }

    private RedisAuthorizationSession session(AuthorizationStatus status, Date expiresAt, long version) {
        return new RedisAuthorizationSession(
            AUTHORIZATION_ID,
            USER_ID,
            CONNECTOR_ID,
            "connector",
            "provider",
            status,
            "encrypted-authorization-url",
            "provider-session",
            "encrypted-provider-state",
            null,
            expiresAt,
            null,
            null,
            version);
    }

    private Date futureExpiry() {
        return new Date(System.currentTimeMillis() + Duration.ofMinutes(10).toMillis());
    }

    private RedisAuthorizationSession copy(
            RedisAuthorizationSession source,
            String authorizationId,
            String userId,
            Long connectorId,
            String connectorCode,
            String providerCode,
            AuthorizationStatus status,
            Date expiresAt) {
        return new RedisAuthorizationSession(
            authorizationId,
            userId,
            connectorId,
            connectorCode,
            providerCode,
            status,
            source.authorizationUrlCipher(),
            source.providerSessionId(),
            source.providerStateCipher(),
            source.ownerInstanceId(),
            expiresAt,
            source.errorCode(),
            source.errorMessage(),
            source.version());
    }

    private String redisHashTag(String key) {
        int start = key.indexOf('{');
        int end = key.indexOf('}', start + 1);
        return start >= 0 && end > start + 1 ? key.substring(start + 1, end) : null;
    }
}
