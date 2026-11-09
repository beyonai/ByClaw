package com.iwhalecloud.byai.state.domain.mobilepush;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.data.redis.connection.RedisClusterConfiguration;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.jedis.JedisConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;

/** 沿用项目显式指定的本机独立测试服务；不自动启动 Redis，不访问应用配置的 Redis。 */
@Timeout(30)
class MobilePushRateLimiterRedisIntegrationTest {
    @Test
    @EnabledIfEnvironmentVariable(named = "BYCLAW_TEST_REDIS_PORT", matches = "[0-9]+")
    void standaloneSharesTheSlotAndExpiresIt() throws Exception {
        verifySharedSlot(new JedisConnectionFactory(new RedisStandaloneConfiguration("127.0.0.1",
            Integer.parseInt(System.getenv("BYCLAW_TEST_REDIS_PORT")))));
    }

    @Test
    @EnabledIfEnvironmentVariable(named = "BYCLAW_TEST_REDIS_CLUSTER_PORT", matches = "[0-9]+")
    void realClusterRoutesTheSameAtomicSlotAcrossWorkers() throws Exception {
        verifySharedSlot(new JedisConnectionFactory(new RedisClusterConfiguration(List.of(
            "127.0.0.1:" + System.getenv("BYCLAW_TEST_REDIS_CLUSTER_PORT")))));
    }

    private void verifySharedSlot(JedisConnectionFactory connection) throws Exception {
        connection.afterPropertiesSet();
        connection.start();
        StringRedisTemplate redis = new StringRedisTemplate(connection);
        MobilePushProperties properties = new MobilePushProperties();
        // 本机专用测试 Redis 使用随机测试 ID，仅清理本次测试对应的键。
        properties.setSdkAppId(ThreadLocalRandom.current().nextLong(1L << 40, 1L << 50));
        String key = "byclaw:mobile-push:rate:{" + properties.getSdkAppId() + "}";
        String notificationId = "a".repeat(64);
        String dedupKey = "byclaw:mobile-push:dedup:{" + properties.getSdkAppId() + "}:" + notificationId;
        MobilePushRateLimiter first = new MobilePushRateLimiter(redis, properties);
        MobilePushRateLimiter second = new MobilePushRateLimiter(redis, properties);
        try {
            assertThat(first.acquire()).isTrue();
            // 验证原子写入自带过期，不会留下永久限速键。
            assertThat(redis.getExpire(key, TimeUnit.MILLISECONDS)).isBetween(0L, 100L);
            // 延长本次测试自有键，避免慢 CI 调度跨过 100ms 导致并发断言失真。
            assertThat(redis.expire(key, Duration.ofSeconds(10))).isTrue();
            try (var workers = Executors.newFixedThreadPool(4)) {
                List<java.util.concurrent.Callable<Boolean>> attempts = new ArrayList<>();
                for (int index = 0; index < 8; index += 1) {
                    attempts.add(second::acquire);
                }
                for (var attempt : workers.invokeAll(attempts)) {
                    assertThat(attempt.get()).isFalse();
                }
            }
            assertThat(redis.opsForValue().get(key)).isEqualTo("1");
            assertThat(redis.expire(key, Duration.ofMillis(1))).isTrue();
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
            while (Boolean.TRUE.equals(redis.hasKey(key)) && System.nanoTime() < deadline) {
                Thread.sleep(10);
            }
            assertThat(second.acquire()).isTrue();
            assertThat(first.firstAttempt(notificationId)).isTrue();
            assertThat(second.firstAttempt(notificationId)).isFalse();
            assertThat(redis.opsForValue().get(dedupKey)).isEqualTo("1");
            assertThat(redis.getExpire(dedupKey, TimeUnit.MILLISECONDS)).isBetween(1L, 600000L);
        } finally {
            // 单键删除只针对本次测试的随机范围，不做 FLUSHDB 或跨槽扫描。
            try {
                redis.delete(key);
                redis.delete(dedupKey);
            } finally {
                connection.destroy();
            }
        }
    }
}
