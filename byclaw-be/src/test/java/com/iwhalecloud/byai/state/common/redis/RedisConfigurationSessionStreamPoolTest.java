package com.iwhalecloud.byai.state.common.redis;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.reflect.Method;
import java.time.Duration;
import java.util.Arrays;

import org.apache.commons.pool2.impl.GenericObjectPoolConfig;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.data.redis.connection.jedis.JedisConnectionFactory;
import org.springframework.test.util.ReflectionTestUtils;

class RedisConfigurationSessionStreamPoolTest {

    @Test
    void blockingReadsUseIndependentBoundedPoolWithControlConnectionHeadroom() throws Exception {
        RedisConfiguration configuration = configuration();
        Method streamFactoryMethod = streamFactoryMethod();
        ReflectionTestUtils.setField(configuration, "sessionStreamMaxListeners", 3);

        JedisConnectionFactory business = (JedisConnectionFactory) configuration.connectionFactory();
        JedisConnectionFactory stream = (JedisConnectionFactory) streamFactoryMethod.invoke(configuration);
        GenericObjectPoolConfig<?> businessPool = business.getPoolConfig();
        GenericObjectPoolConfig<?> streamPool = stream.getPoolConfig();

        assertNotSame(business, stream);
        assertNotSame(businessPool, streamPool);
        assertEquals(500, businessPool.getMaxTotal());
        assertEquals(4, streamPool.getMaxTotal());
        assertTrue(streamPool.getMaxIdle() <= streamPool.getMaxTotal());
        assertEquals(0, streamPool.getMinIdle());
        assertFalse(streamPool.getBlockWhenExhausted(), "Blocking readers must fail fast at pool exhaustion");
        assertTrue(RedisConfiguration.class.getMethod("connectionFactory").isAnnotationPresent(Primary.class));
        assertFalse(streamFactoryMethod.isAnnotationPresent(Primary.class));
        assertNotNull(streamFactoryMethod.getAnnotation(Bean.class));
    }

    @ParameterizedTest
    @ValueSource(strings = {"standalone", "sentinel", "cluster"})
    void dedicatedPoolPreservesDeploymentCredentialsAndTimeouts(String mode) throws Exception {
        RedisConfiguration configuration = configuration();
        Method streamFactoryMethod = streamFactoryMethod();
        if ("sentinel".equals(mode)) {
            ReflectionTestUtils.setField(configuration, "master", "test-master");
            ReflectionTestUtils.setField(configuration, "sentinels", "localhost:26379,localhost:26380");
        }
        else if ("cluster".equals(mode)) {
            ReflectionTestUtils.setField(configuration, "clusters", "localhost:7000,localhost:7001");
            ReflectionTestUtils.setField(configuration, "database", "0");
        }

        JedisConnectionFactory business = (JedisConnectionFactory) configuration.connectionFactory();
        JedisConnectionFactory stream = (JedisConnectionFactory) streamFactoryMethod.invoke(configuration);

        assertEquals(business.isRedisClusterAware(), stream.isRedisClusterAware());
        assertEquals(business.getSentinelConfiguration(), stream.getSentinelConfiguration());
        assertEquals(business.getClusterConfiguration(), stream.getClusterConfiguration());
        assertEquals(business.getHostName(), stream.getHostName());
        assertEquals(business.getPort(), stream.getPort());
        assertEquals("test-password", stream.getPassword());
        assertEquals("cluster".equals(mode) ? 0 : 2, stream.getDatabase());
        assertTrue(stream.getClientConfiguration().isUseSsl());
        assertTrue(stream.getClientConfiguration().isUsePooling());
        assertEquals(Duration.ofMillis(1500), stream.getClientConfiguration().getConnectTimeout());
        assertEquals(Duration.ofMillis(6000), stream.getClientConfiguration().getReadTimeout());
    }

    @ParameterizedTest
    @ValueSource(ints = {0, -1, Integer.MAX_VALUE})
    void rejectsListenerLimitsThatCannotProvideABoundedPool(int limit) {
        RedisConfiguration configuration = configuration();
        streamFactoryMethod();
        ReflectionTestUtils.setField(configuration, "sessionStreamMaxListeners", limit);

        assertThrows(IllegalArgumentException.class,
            () -> ReflectionTestUtils.invokeMethod(configuration, "sessionStreamRedisConnectionFactory"));
    }

    private Method streamFactoryMethod() {
        Method method = Arrays.stream(RedisConfiguration.class.getDeclaredMethods())
            .filter(candidate -> candidate.getName().equals("sessionStreamRedisConnectionFactory"))
            .findFirst().orElse(null);
        assertNotNull(method, "Session stream blocking reads need their own Redis connection factory bean");
        return method;
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
