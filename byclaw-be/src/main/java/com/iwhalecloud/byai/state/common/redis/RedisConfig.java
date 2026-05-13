package com.iwhalecloud.byai.state.common.redis;

import java.time.Duration;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.data.redis.cache.RedisCacheConfiguration;
import org.springframework.data.redis.cache.RedisCacheManager;
import org.springframework.data.redis.cache.RedisCacheWriter;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.serializer.Jackson2JsonRedisSerializer;
import org.springframework.data.redis.serializer.RedisSerializationContext;
import org.springframework.data.redis.serializer.RedisSerializer;
import org.springframework.data.redis.serializer.StringRedisSerializer;

/**
 * @author chenmuchao
 * @version 1.0
 * @description redis 的自定义序列化配置，来自RedisAutoConfiguration
 * @date 2020/7/15 13:56
 */
@Configuration
public class RedisConfig {

    @Value("${CACHE_TTL_MINUTES:180}")
    private long cacheTtlMinutes;

    @Bean(name = "redisTemplate")
    public RedisTemplate<String, Object> redisTemplate(RedisConnectionFactory redisConnectionFactory) {

        RedisTemplate<String, Object> template = new RedisTemplate<>();
        template.setConnectionFactory(redisConnectionFactory);

        // 使用String序列化器来序列化和反序列化key
        template.setKeySerializer(new StringRedisSerializer());

        // 使用StringRedisSerializer来序列化和反序列化value
        StringRedisSerializer serializer = new StringRedisSerializer();
//        ObjectMapper mapper = new ObjectMapper();
        // 配置ObjectMapper以处理特定的数据类型（如果需要）
//        serializer.setObjectMapper(mapper);
        template.setValueSerializer(serializer);

        // 如果需要，还可以设置hash key和value的序列化器
        template.setHashKeySerializer(new StringRedisSerializer());
        template.setHashValueSerializer(serializer);

        template.afterPropertiesSet();
        return template;
    }

    @Primary
    @Bean
    public RedisCacheManager cacheManager(RedisConnectionFactory redisConnectionFactory) {
        RedisCacheConfiguration redisCacheConfiguration = RedisCacheConfiguration.defaultCacheConfig();
        redisCacheConfiguration = redisCacheConfiguration.entryTtl(Duration.ofMinutes(cacheTtlMinutes))
            .disableCachingNullValues()
            .serializeKeysWith(RedisSerializationContext.SerializationPair.fromSerializer(keySerializer()))
            .serializeValuesWith(
                RedisSerializationContext.SerializationPair.fromSerializer((new StringRedisSerializer()))); // 设置value序列化器
        return RedisCacheManager.builder(RedisCacheWriter.nonLockingRedisCacheWriter(redisConnectionFactory))
            .cacheDefaults(redisCacheConfiguration).build();
    }

    private RedisSerializer<?> valueSerializer() {
        return new Jackson2JsonRedisSerializer(Object.class);
    }

    private RedisSerializer<String> keySerializer() {
        return new StringRedisSerializer();
    }

}
