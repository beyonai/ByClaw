package com.iwhalecloud.byai.common.util;

import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.data.redis.connection.RedisClusterConfiguration;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.RedisSentinelConfiguration;
import org.springframework.data.redis.connection.jedis.JedisConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;

/** Ports must refer to disposable local test instances. */
class RedisUtilPrefixIntegrationTest {
    @Test
    @EnabledIfEnvironmentVariable(named = "BYCLAW_TEST_REDIS_CLUSTER_PORT", matches = "[0-9]+")
    void clusterDeletesAcrossSlots() {
        verifyDeletion(new JedisConnectionFactory(new RedisClusterConfiguration(List.of(
            "127.0.0.1:" + System.getenv("BYCLAW_TEST_REDIS_CLUSTER_PORT")))));
    }

    @Test
    @EnabledIfEnvironmentVariable(named = "BYCLAW_TEST_REDIS_PORT", matches = "[0-9]+")
    void standaloneUsesConfiguredDatabase() {
        RedisStandaloneConfiguration config = new RedisStandaloneConfiguration("127.0.0.1",
            Integer.parseInt(System.getenv("BYCLAW_TEST_REDIS_PORT")));
        config.setDatabase(2);
        verifyDeletion(new JedisConnectionFactory(config));
    }

    @Test
    @EnabledIfEnvironmentVariable(named = "BYCLAW_TEST_REDIS_SENTINEL_PORT", matches = "[0-9]+")
    void sentinelUsesConfiguredDatabase() {
        RedisSentinelConfiguration config = new RedisSentinelConfiguration().master("prefix-test")
            .sentinel("127.0.0.1", Integer.parseInt(System.getenv("BYCLAW_TEST_REDIS_SENTINEL_PORT")));
        config.setDatabase(2);
        verifyDeletion(new JedisConnectionFactory(config));
    }

    private void verifyDeletion(JedisConnectionFactory factory) {
        Object previous = ReflectionTestUtils.getField(RedisUtil.class, "instance");
        factory.afterPropertiesSet();
        StringRedisTemplate template = new StringRedisTemplate(factory);
        RedisUtil util = new RedisUtil();
        ReflectionTestUtils.setField(util, "stringRedisTemplate", template);
        ReflectionTestUtils.setField(RedisUtil.class, "instance", util);
        String prefix = "prefix-test:" + UUID.randomUUID() + ":";
        List<String> keys = new java.util.ArrayList<>();
        for (String tag : List.of("a", "b", "c")) {
            for (int i = 0; i < 900; i++) {
                keys.add(prefix + "{" + tag + "}:中文:" + i);
            }
        }
        var executor = java.util.concurrent.Executors.newFixedThreadPool(3);
        var stop = new java.util.concurrent.atomic.AtomicBoolean();
        var ready = new java.util.concurrent.CountDownLatch(3);
        List<java.util.concurrent.Future<?>> readers = new java.util.ArrayList<>();
        List<String> concurrentKeys = List.of(prefix + "noise:{a}", prefix + "noise:{b}", prefix + "noise:{c}");
        String unrelated = prefix + "other:keep";
        try {
            keys.forEach(key -> template.opsForValue().set(key, "value"));
            template.opsForValue().set(unrelated, "keep");
            for (String key : concurrentKeys) {
                readers.add(executor.submit(() -> {
                    template.opsForValue().set(key, "keep");
                    ready.countDown();
                    while (!stop.get() && !Thread.currentThread().isInterrupted()) {
                        template.opsForValue().set(key, "keep");
                        assertThat(template.opsForValue().get(key)).isEqualTo("keep");
                    }
                }));
            }
            assertThat(ready.await(10, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
            RedisUtil.delByPrefix(prefix + "{");
            stop.set(true);
            for (var reader : readers) {
                reader.get(10, java.util.concurrent.TimeUnit.SECONDS);
            }
            keys.forEach(key -> assertThat(template.hasKey(key)).isFalse());
            assertThat(template.opsForValue().get(unrelated)).isEqualTo("keep");
            RedisUtil.delByPrefix(prefix + "missing:");
        }
        catch (Exception e) {
            throw new AssertionError("Concurrent prefix cleanup failed", e);
        }
        finally {
            stop.set(true);
            executor.shutdownNow();
            try {
                executor.awaitTermination(10, java.util.concurrent.TimeUnit.SECONDS);
            }
            catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            concurrentKeys.forEach(template::delete);
            keys.forEach(template::delete);
            template.delete(unrelated);
            ReflectionTestUtils.setField(RedisUtil.class, "instance", previous);
            factory.destroy();
        }
    }
}
