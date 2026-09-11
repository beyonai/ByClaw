package com.iwhalecloud.byai.state.common.redis;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.test.util.ReflectionTestUtils;

class RedisConfigurationSessionStreamPoolTest {

    @ParameterizedTest
    @ValueSource(strings = {"standalone", "sentinel", "cluster", "url"})
    void reactiveNioReadsUseSharedLettuceConnectionsForEveryTopology(String mode) {
        RedisConfiguration configuration = configuration();
        if ("sentinel".equals(mode)) {
            ReflectionTestUtils.setField(configuration, "master", "test-master");
            ReflectionTestUtils.setField(configuration, "sentinels", "localhost:26379,localhost:26380");
        }
        else if ("cluster".equals(mode)) {
            ReflectionTestUtils.setField(configuration, "clusters", "localhost:7000,localhost:7001");
            ReflectionTestUtils.setField(configuration, "database", "0");
        }
        else if ("url".equals(mode)) {
            ReflectionTestUtils.setField(configuration, "host", "");
            ReflectionTestUtils.setField(configuration, "port", "");
            ReflectionTestUtils.setField(configuration, "url", "rediss://url-user:url-password@localhost:6380/4");
        }

        LettuceConnectionFactory stream = ReflectionTestUtils.invokeMethod(configuration,
            "sessionStreamReactiveRedisConnectionFactory");

        assertNotNull(stream);
        assertEquals("cluster".equals(mode), stream.getClusterConfiguration() != null);
        assertEquals("sentinel".equals(mode), stream.getSentinelConfiguration() != null);
        assertEquals("url".equals(mode) ? "url-password" : "test-password", stream.getPassword());
        assertEquals("url".equals(mode) ? 4 : "cluster".equals(mode) ? 0 : 2, stream.getDatabase());
        assertTrue(stream.getShareNativeConnection(), "Non-blocking reads should share Lettuce NIO connections");
        assertEquals(Duration.ofMillis(6000), stream.getClientConfiguration().getCommandTimeout());
        assertEquals(Duration.ofMillis(1500), stream.getClientConfiguration().getClientOptions().orElseThrow()
            .getSocketOptions().getConnectTimeout());
    }

    private RedisConfiguration configuration() {
        RedisConfiguration configuration = new RedisConfiguration();
        ReflectionTestUtils.setField(configuration, "redisProperties", new RedisProperties());
        ReflectionTestUtils.setField(configuration, "host", "localhost");
        ReflectionTestUtils.setField(configuration, "port", "6379");
        ReflectionTestUtils.setField(configuration, "database", "2");
        ReflectionTestUtils.setField(configuration, "password", "test-password");
        ReflectionTestUtils.setField(configuration, "maxRedirects", "5");
        ReflectionTestUtils.setField(configuration, "timeout", 1500);
        ReflectionTestUtils.setField(configuration, "readTimeout", 6000);
        ReflectionTestUtils.setField(configuration, "ssl", true);
        return configuration;
    }
}
