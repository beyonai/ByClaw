package com.iwhalecloud.byai.manager.domain.connector.authorization;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.time.Duration;
import java.util.Base64;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;
import java.util.stream.IntStream;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.data.redis.connection.RedisClusterConfiguration;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.jedis.JedisConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;

/**
 * Real repository/Lua contracts on disposable localhost Redis servers, enabled with
 * BYCLAW_TEST_AUTH_REDIS_INTEGRATION=true and BYCLAW_TEST_AUTH_REDIS_{STANDALONE,CLUSTER}_PORT.
 * Cipher fixtures are opaque test strings, not an SM4 implementation; service tests cover encryption.
 * Only this test's UUID-namespaced keys are deleted. No FLUSH, SCAN or logical database selection is used.
 */
@EnabledIfEnvironmentVariable(named = "BYCLAW_TEST_AUTH_REDIS_INTEGRATION", matches = "true")
class RedisAuthorizationSessionRepositoryIntegrationTest {

    private static final Long CONNECTOR_ID = 3L;
    private static final String PREFIX = "connector:authorization:{auth}:";

    @ParameterizedTest(name = "scope state survives create/read and pending progress; cluster={0}")
    @ValueSource(booleans = {false, true})
    void persistsScopeStateAcrossInstancesAndExtendsBothPendingTtls(boolean cluster) throws Exception {
        try (Fixture fixture = new Fixture(cluster)) {
            String initialCipher = scopeCipher("unavailable");
            RedisAuthorizationSession initial = fixture.session(initialCipher, Duration.ofSeconds(20));
            fixture.first.repository.create(initial);

            assertThat(fixture.second.repository.find(initial.authorizationId())).contains(initial);
            assertThat(fixture.second.repository.findOwned(initial.authorizationId(), "another-user")).isEmpty();
            assertThat(fixture.second.repository.findActiveSession(fixture.userId, CONNECTOR_ID)).contains(initial);
            assertThat(fixture.ttl(sessionKey(initial))).isBetween(1L, 20_000L);
            assertThat(fixture.ttl(indexKey(fixture.userId))).isBetween(1L, 20_000L);

            String expandedCipher = scopeCipher("complete");
            Date extendedExpiry = expiresIn(Duration.ofMinutes(2));
            RedisAuthorizationSession progress = replacement(
                initial, AuthorizationStatus.PENDING, "user_authorization", expandedCipher, extendedExpiry);
            assertThat(fixture.second.repository.compareAndSetStatus(
                initial.authorizationId(), AuthorizationStatus.PENDING, 0L, progress)).isTrue();

            RedisAuthorizationSession stored = fixture.first.repository.find(initial.authorizationId()).orElseThrow();
            assertThat(stored.version()).isEqualTo(1L);
            assertThat(stored.phase()).isEqualTo("user_authorization");
            assertThat(stored.providerStateCipher()).isEqualTo(expandedCipher);
            assertThat(stored.expiresAt()).isEqualTo(extendedExpiry);
            assertThat(fixture.second.repository.findActiveSession(fixture.userId, CONNECTOR_ID)).contains(stored);
            assertThat(fixture.ttl(sessionKey(initial))).isBetween(90_000L, 120_000L);
            assertThat(fixture.ttl(indexKey(fixture.userId))).isBetween(90_000L, 120_000L);
            assertThat(fixture.first.redis.opsForValue().get(sessionKey(initial)))
                .doesNotContain("requestedUserScopes", "contact:contact.base:readonly");
        }
    }

    @ParameterizedTest(name = "create and CAS preserve active owner; cluster={0}")
    @ValueSource(booleans = {false, true})
    void rejectsDuplicateActiveSessionsAndWrongIdentityCas(boolean cluster) throws Exception {
        try (Fixture fixture = new Fixture(cluster)) {
            RedisAuthorizationSession initial = fixture.session(scopeCipher("complete"), Duration.ofMinutes(1));
            fixture.first.repository.create(initial);
            RedisAuthorizationSession duplicate = fixture.session("other-cipher", Duration.ofMinutes(1));
            assertThatThrownBy(() -> fixture.second.repository.create(duplicate))
                .isInstanceOf(IllegalStateException.class);
            assertThat(fixture.first.repository.find(duplicate.authorizationId())).isEmpty();

            RedisAuthorizationSession wrongOwner = new RedisAuthorizationSession(
                initial.authorizationId(), fixture.userId + "-other", CONNECTOR_ID, "lark", "lark-cli",
                AuthorizationStatus.FINALIZING, initial.phase(), initial.authorizationUrlCipher(),
                initial.providerSessionId(), "wrong-owner-cipher", "replica-b", initial.expiresAt(),
                null, null, initial.manifestDigest(), 1L);
            fixture.keys.add(indexKey(wrongOwner.userId()));
            assertThat(fixture.second.repository.compareAndSetStatus(
                initial.authorizationId(), AuthorizationStatus.PENDING, 0L, wrongOwner)).isFalse();
            assertThat(fixture.first.repository.find(initial.authorizationId())).contains(initial);
            assertThat(fixture.first.repository.findActiveSession(fixture.userId, CONNECTOR_ID)).contains(initial);
            assertThat(fixture.first.redis.hasKey(indexKey(wrongOwner.userId()))).isFalse();
        }
    }

    @ParameterizedTest(name = "concurrent finalization has one winner; cluster={0}")
    @ValueSource(booleans = {false, true})
    void concurrentCasFromIndependentConnectionsHasExactlyOneWinner(boolean cluster) throws Exception {
        try (Fixture fixture = new Fixture(cluster)) {
            RedisAuthorizationSession initial = fixture.session(scopeCipher("complete"), Duration.ofMinutes(1));
            fixture.first.repository.create(initial);
            RedisAuthorizationSession left = replacement(initial, AuthorizationStatus.FINALIZING,
                initial.phase(), "candidate-a-cipher", expiresIn(Duration.ofMinutes(10)));
            RedisAuthorizationSession right = replacement(initial, AuthorizationStatus.FINALIZING,
                initial.phase(), "candidate-b-cipher", expiresIn(Duration.ofMinutes(10)));
            var ready = new CountDownLatch(2);
            var start = new CountDownLatch(1);
            var executor = Executors.newFixedThreadPool(2);
            try {
                var first = executor.submit(() -> {
                    ready.countDown();
                    assertThat(start.await(5, TimeUnit.SECONDS)).isTrue();
                    return fixture.first.repository.compareAndSetStatus(
                        initial.authorizationId(), AuthorizationStatus.PENDING, 0L, left);
                });
                var second = executor.submit(() -> {
                    ready.countDown();
                    assertThat(start.await(5, TimeUnit.SECONDS)).isTrue();
                    return fixture.second.repository.compareAndSetStatus(
                        initial.authorizationId(), AuthorizationStatus.PENDING, 0L, right);
                });
                assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
                start.countDown();
                boolean firstWon = first.get(10, TimeUnit.SECONDS);
                boolean secondWon = second.get(10, TimeUnit.SECONDS);
                assertThat(firstWon ^ secondWon).isTrue();
                RedisAuthorizationSession stored = fixture.second.repository.find(initial.authorizationId()).orElseThrow();
                assertThat(stored.status()).isEqualTo(AuthorizationStatus.FINALIZING);
                assertThat(stored.version()).isEqualTo(1L);
                assertThat(stored.providerStateCipher())
                    .isEqualTo(firstWon ? left.providerStateCipher() : right.providerStateCipher());
                assertThat(stored.expiresAt()).isEqualTo(initial.expiresAt());
                assertThat(fixture.ttl(sessionKey(initial))).isBetween(1L, 60_000L);
                assertThat(fixture.first.repository.compareAndSetStatus(
                    initial.authorizationId(), AuthorizationStatus.PENDING, 0L, left)).isFalse();
            } finally {
                start.countDown();
                executor.shutdownNow();
                assertThat(executor.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
            }
        }
    }

    @ParameterizedTest(name = "terminal cleanup removes scope secrets and active index; cluster={0}")
    @ValueSource(booleans = {false, true})
    void terminalTransitionsReleaseActiveIndexAndDeleteScopeSecretsWithoutExtendingTtl(boolean cluster)
            throws Exception {
        try (Fixture fixture = new Fixture(cluster)) {
            for (AuthorizationStatus terminal : List.of(AuthorizationStatus.CONNECTED, AuthorizationStatus.FAILED,
                    AuthorizationStatus.CANCELLED, AuthorizationStatus.EXPIRED)) {
                RedisAuthorizationSession initial = fixture.session(scopeCipher("complete"), Duration.ofMinutes(1));
                fixture.first.repository.create(initial);
                RedisAuthorizationSession finishing = replacement(initial, AuthorizationStatus.FINALIZING,
                    initial.phase(), initial.providerStateCipher(), initial.expiresAt());
                assertThat(fixture.first.repository.compareAndSetStatus(
                    initial.authorizationId(), AuthorizationStatus.PENDING, 0L, finishing)).isTrue();
                RedisAuthorizationSession completed = replacement(initial, terminal,
                    initial.phase(), initial.providerStateCipher(), expiresIn(Duration.ofMinutes(10)));
                assertThat(fixture.second.repository.compareAndSetStatus(
                    initial.authorizationId(), AuthorizationStatus.FINALIZING, 1L, completed)).isTrue();
                assertThat(fixture.first.repository.findActiveSession(fixture.userId, CONNECTOR_ID)).isEmpty();
                assertThat(fixture.first.redis.hasKey(indexKey(fixture.userId))).isFalse();
                long ttlBeforeCleanup = fixture.ttl(sessionKey(initial));
                assertThat(fixture.first.repository.deleteSecrets(initial.authorizationId())).isTrue();
                RedisAuthorizationSession stored = fixture.second.repository.find(initial.authorizationId()).orElseThrow();
                assertThat(stored.status()).isEqualTo(terminal);
                assertThat(stored.version()).isEqualTo(3L);
                assertThat(stored.authorizationUrlCipher()).isNull();
                assertThat(stored.providerStateCipher()).isNull();
                assertThat(stored.expiresAt()).isEqualTo(initial.expiresAt());
                assertThat(stored.manifestDigest()).isEqualTo(initial.manifestDigest());
                assertThat(fixture.ttl(sessionKey(initial))).isBetween(1L, ttlBeforeCleanup);
                assertThat(fixture.first.repository.compareAndSetStatus(
                    initial.authorizationId(), terminal, 3L, finishing)).isFalse();
            }
        }
    }

    @ParameterizedTest(name = "locks validate owner even after expiry; cluster={0}")
    @ValueSource(booleans = {false, true})
    void onlyTheCurrentOwnerCanReleaseStatusAndStartLocks(boolean cluster) throws Exception {
        try (Fixture fixture = new Fixture(cluster)) {
            RedisAuthorizationSession initial = fixture.session("scope-cipher", Duration.ofMinutes(1));
            String firstToken = fixture.first.repository.tryAcquireStatusLock(
                initial.authorizationId(), Duration.ofMillis(500)).orElseThrow();
            fixture.second.repository.releaseStatusLock(initial.authorizationId(), "wrong-token");
            assertThat(fixture.second.repository.tryAcquireStatusLock(
                initial.authorizationId(), Duration.ofSeconds(10))).isEmpty();
            await(() -> !Boolean.TRUE.equals(fixture.first.redis.hasKey(statusLockKey(initial))));
            String secondToken = fixture.second.repository.tryAcquireStatusLock(
                initial.authorizationId(), Duration.ofSeconds(10)).orElseThrow();
            fixture.first.repository.releaseStatusLock(initial.authorizationId(), firstToken);
            assertThat(fixture.first.redis.opsForValue().get(statusLockKey(initial))).isEqualTo(secondToken);
            fixture.second.repository.releaseStatusLock(initial.authorizationId(), secondToken);
            assertThat(fixture.first.redis.hasKey(statusLockKey(initial))).isFalse();

            String startToken = fixture.first.repository.tryAcquireStartLock(
                fixture.userId, CONNECTOR_ID, Duration.ofSeconds(10)).orElseThrow();
            fixture.second.repository.releaseStartLock(fixture.userId, CONNECTOR_ID, "wrong-token");
            assertThat(fixture.second.repository.tryAcquireStartLock(
                fixture.userId, CONNECTOR_ID, Duration.ofSeconds(10))).isEmpty();
            fixture.first.repository.releaseStartLock(fixture.userId, CONNECTOR_ID, startToken);
            assertThat(fixture.second.repository.tryAcquireStartLock(
                fixture.userId, CONNECTOR_ID, Duration.ofSeconds(10))).isPresent();
        }
    }

    @ParameterizedTest(name = "session and active index expire together; cluster={0}")
    @ValueSource(booleans = {false, true})
    void expiredScopeStateCannotBeRecoveredOrAdvanced(boolean cluster) throws Exception {
        try (Fixture fixture = new Fixture(cluster)) {
            RedisAuthorizationSession initial = fixture.session(scopeCipher("complete"), Duration.ofMillis(500));
            fixture.first.repository.create(initial);
            assertThat(fixture.second.repository.find(initial.authorizationId())).contains(initial);
            await(() -> !Boolean.TRUE.equals(fixture.first.redis.hasKey(sessionKey(initial))));
            assertThat(fixture.second.repository.find(initial.authorizationId())).isEmpty();
            assertThat(fixture.second.repository.findActiveSession(fixture.userId, CONNECTOR_ID)).isEmpty();
            assertThat(fixture.first.redis.hasKey(indexKey(fixture.userId))).isFalse();
            assertThat(fixture.second.repository.deleteSecrets(initial.authorizationId())).isFalse();
            assertThat(fixture.first.repository.compareAndSetStatus(initial.authorizationId(),
                AuthorizationStatus.PENDING, 0L, replacement(initial, AuthorizationStatus.FINALIZING,
                    initial.phase(), "late-cipher", expiresIn(Duration.ofMinutes(1))))).isFalse();
        }
    }

    private static RedisAuthorizationSession replacement(RedisAuthorizationSession source, AuthorizationStatus status,
            String phase, String cipher, Date expiry) {
        return new RedisAuthorizationSession(source.authorizationId(), source.userId(), source.connectorId(),
            source.connectorCode(), source.providerCode(), status, phase, source.authorizationUrlCipher(),
            source.providerSessionId(), cipher, "replica-b", expiry, null, null, source.manifestDigest(), 99L);
    }

    private static String scopeCipher(String discovery) throws Exception {
        var scopes = IntStream.range(0, 300).mapToObj(i -> "contact:test.resource" + i + ":readonly").toList();
        String state = new ObjectMapper().writeValueAsString(java.util.Map.of(
            "deviceCode", "test-device-code", "scopeDiscovery", discovery, "requestedUserScopes", scopes,
            "extraUserScopes", List.of("contact:contact.base:readonly", "contact:department.organize:readonly")));
        return "opaque-test-cipher:" + Base64.getEncoder().encodeToString(state.getBytes(StandardCharsets.UTF_8));
    }

    private static Date expiresIn(Duration ttl) {
        return new Date(System.currentTimeMillis() + ttl.toMillis());
    }

    private static String sessionKey(RedisAuthorizationSession session) {
        return PREFIX + "session:" + session.authorizationId();
    }

    private static String indexKey(String userId) {
        return PREFIX + "user:" + userId + ":" + CONNECTOR_ID;
    }

    private static String statusLockKey(RedisAuthorizationSession session) {
        return PREFIX + "status-lock:" + session.authorizationId();
    }

    private static void await(BooleanSupplier condition) throws InterruptedException {
        long deadline = System.nanoTime() + Duration.ofSeconds(5).toNanos();
        while (!condition.getAsBoolean() && System.nanoTime() < deadline) {
            Thread.sleep(20);
        }
        assertThat(condition.getAsBoolean()).as("Redis TTL expires within the bounded wait").isTrue();
    }

    private static final class Fixture implements AutoCloseable {
        private final String userId = "redis-auth-it-" + UUID.randomUUID();
        private final Set<String> keys = new HashSet<>();
        private final Client first;
        private final Client second;

        private Fixture(boolean cluster) {
            String variable = cluster ? "BYCLAW_TEST_AUTH_REDIS_CLUSTER_PORT" : "BYCLAW_TEST_AUTH_REDIS_STANDALONE_PORT";
            String configuredPort = System.getenv(variable);
            assertThat(configuredPort).as(variable).matches("[0-9]+");
            int port = Integer.parseInt(configuredPort);
            first = new Client(cluster, port);
            try {
                second = new Client(cluster, port);
            } catch (RuntimeException | Error e) {
                first.factory.destroy();
                throw e;
            }
            keys.add(indexKey(userId));
            keys.add(PREFIX + "start-lock:" + userId + ":" + CONNECTOR_ID);
        }

        private RedisAuthorizationSession session(String cipher, Duration ttl) {
            var session = new RedisAuthorizationSession("redis-auth-it-" + UUID.randomUUID(), userId,
                CONNECTOR_ID, "lark", "lark-cli", AuthorizationStatus.PENDING, "application_initialization",
                "opaque-url-cipher", "provider-session", cipher, "replica-a", expiresIn(ttl),
                null, null, "manifest-digest", 0L);
            keys.add(sessionKey(session));
            keys.add(statusLockKey(session));
            return session;
        }

        private long ttl(String key) {
            Long ttl = first.redis.getExpire(key, TimeUnit.MILLISECONDS);
            assertThat(ttl).isNotNull();
            return ttl;
        }

        @Override
        public void close() {
            try {
                for (String key : keys) {
                    first.redis.delete(key);
                }
            } finally {
                try {
                    second.factory.destroy();
                } finally {
                    first.factory.destroy();
                }
            }
        }
    }

    private static final class Client {
        private final JedisConnectionFactory factory;
        private final StringRedisTemplate redis;
        private final RedisAuthorizationSessionRepository repository;

        private Client(boolean cluster, int port) {
            factory = cluster
                ? new JedisConnectionFactory(new RedisClusterConfiguration(List.of("127.0.0.1:" + port)))
                : new JedisConnectionFactory(new RedisStandaloneConfiguration("127.0.0.1", port));
            try {
                factory.afterPropertiesSet();
                redis = new StringRedisTemplate(factory);
                ObjectMapper mapper = new ObjectMapper();
                mapper.setDateFormat(new SimpleDateFormat("yyyy-MM-dd HH:mm:ss"));
                mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
                repository = new RedisAuthorizationSessionRepository(redis, mapper);
            } catch (RuntimeException | Error e) {
                factory.destroy();
                throw e;
            }
        }
    }
}
