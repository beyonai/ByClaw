package com.iwhalecloud.byai.common.util;

import java.net.ServerSocket;
import java.time.Duration;
import java.util.ArrayList;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.util.ReflectionTestUtils;
import static org.assertj.core.api.Assertions.assertThat;

class SmsRateLimitRedisTest {
    @Test
    @Timeout(30)
    void concurrentAttemptsCannotExceedLimitAndWindowExpires() throws Exception {
        String executable = System.getProperty("test.redis.server");
        org.junit.jupiter.api.Assumptions.assumeTrue(executable != null,
            "Set -Dtest.redis.server=/path/to/redis-server to run real Redis coverage");
        int port;
        try (ServerSocket socket = new ServerSocket(0)) { port = socket.getLocalPort(); }
        Process process = new ProcessBuilder(executable, "--bind", "127.0.0.1", "--port", String.valueOf(port),
            "--save", "", "--appendonly", "no").redirectOutput(ProcessBuilder.Redirect.DISCARD)
            .redirectError(ProcessBuilder.Redirect.DISCARD).start();
        LettuceConnectionFactory factory = new LettuceConnectionFactory("127.0.0.1", port);
        Object original = ReflectionTestUtils.getField(RedisUtil.class, "instance");
        try {
            factory.afterPropertiesSet();
            StringRedisTemplate template = new StringRedisTemplate(factory);
            org.awaitility.Awaitility.await().atMost(Duration.ofSeconds(10)).ignoreExceptions()
                .until(() -> "PONG".equals(template.execute((org.springframework.data.redis.core.RedisCallback<String>) c -> c.ping())));
            RedisUtil util = new RedisUtil();
            ReflectionTestUtils.setField(util, "stringRedisTemplate", template);
            ReflectionTestUtils.setField(RedisUtil.class, "instance", util);
            try (var executor = Executors.newFixedThreadPool(16)) {
                var futures = new ArrayList<java.util.concurrent.Future<Boolean>>();
                for (int i = 0; i < 100; i++) {
                    futures.add(executor.submit(() -> RedisUtil.reserveAttempt("sms:test:attempts", 3, 30)));
                }
                int accepted = 0;
                for (var future : futures) { if (future.get()) { accepted++; } }
                assertThat(accepted).isEqualTo(3);
                assertThat(template.getExpire("sms:test:attempts")).isBetween(1L, 30L);
            }
            assertThat(RedisUtil.reserveAttempt("sms:test:expiry", 1, 1)).isTrue();
            assertThat(RedisUtil.reserveAttempt("sms:test:expiry", 1, 1)).isFalse();
            org.awaitility.Awaitility.await().atMost(Duration.ofSeconds(5))
                .until(() -> RedisUtil.reserveAttempt("sms:test:expiry", 1, 1));
        } finally {
            ReflectionTestUtils.setField(RedisUtil.class, "instance", original);
            factory.destroy();
            process.destroy();
            if (!process.waitFor(5, java.util.concurrent.TimeUnit.SECONDS)) { process.destroyForcibly(); }
        }
    }
}
