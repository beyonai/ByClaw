package com.iwhalecloud.byai.state.common.redis;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Custom JedisPoolConfig that extends Redis library's pool configuration
 * This class provides additional functionality and logging for Jedis connection pool
 */
public class CustomJedisPoolConfig extends redis.clients.jedis.JedisPoolConfig {

    private static final Logger logger = LoggerFactory.getLogger(CustomJedisPoolConfig.class);

    public CustomJedisPoolConfig() {
        super();
        logger.info("Initializing custom JedisPoolConfig");
    }

    /**
     * Set pool configuration using RedisProperties
     * 
     * @param properties Redis connection pool properties
     */
    public void setPoolConfig(RedisProperties properties) {
        // Set basic pool sizes
        setMaxTotal(properties.getMaxActive());
        setMaxIdle(properties.getMaxIdle());
        setMinIdle(properties.getMinIdle());
        setMaxWaitMillis(properties.getMaxWait());

        // Set connection test settings
        setTestWhileIdle(properties.isTestWhileIdle());
        setTestOnBorrow(properties.isTestOnBorrow());
        setTestOnReturn(properties.isTestOnReturn());

        // Set eviction settings
        setTimeBetweenEvictionRunsMillis(properties.getEvictionInterval());
        setMinEvictableIdleTimeMillis(properties.getMinEvictableIdleTime());
        setNumTestsPerEvictionRun(properties.getNumTestsPerEvictionRun());
        
        // Set additional settings
        setBlockWhenExhausted(properties.isBlockWhenExhausted());
        setJmxEnabled(true);

        // Log all configured parameters
        logger.info("Redis connection pool configuration:" +
            "\n  Max Total: {}" +
            "\n  Max Idle: {}" +
            "\n  Min Idle: {}" +
            "\n  Max Wait: {}ms" +
            "\n  Test While Idle: {}" +
            "\n  Test On Borrow: {}" +
            "\n  Test On Return: {}" +
            "\n  Eviction Interval: {}ms" +
            "\n  Min Evictable Idle Time: {}ms" +
            "\n  Tests Per Eviction Run: {}" +
            "\n  Block When Exhausted: {}",
            properties.getMaxActive(),
            properties.getMaxIdle(),
            properties.getMinIdle(),
            properties.getMaxWait(),
            properties.isTestWhileIdle(),
            properties.isTestOnBorrow(),
            properties.isTestOnReturn(),
            properties.getEvictionInterval(),
            properties.getMinEvictableIdleTime(),
            properties.getNumTestsPerEvictionRun(),
            properties.isBlockWhenExhausted()
        );
    }
}
