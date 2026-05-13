package com.iwhalecloud.byai.state.common.redis;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import lombok.Data;

/**
 * Redis connection pool properties configuration.
 * Maps to spring.redis.pool.* properties in configuration files.
 */
@Data
@Component
@ConfigurationProperties(prefix = "spring.redis.pool")
public class RedisProperties {
    /**
     * Maximum number of active connections that can be allocated
     */
    private int maxActive = 500;

    /**
     * Maximum number of idle connections in the pool
     */
    private int maxIdle = 125;

    /**
     * Minimum number of idle connections to maintain
     */
    private int minIdle = 50;

    /**
     * Maximum time (ms) to wait for a connection
     */
    private int maxWait = 3000;

    /**
     * Test connections while idle
     */
    private boolean testWhileIdle = true;

    /**
     * Test connection before borrowing
     */
    private boolean testOnBorrow = true;

    /**
     * Test connection before returning
     */
    private boolean testOnReturn = false;

    /**
     * Interval (ms) between eviction runs
     */
    private long evictionInterval = 60000;

    /**
     * Minimum time (ms) a connection can be idle before eviction
     */
    private long minEvictableIdleTime = 300000;

    /**
     * Number of connections to test per eviction run
     */
    private int numTestsPerEvictionRun = 3;

    /**
     * Whether to block when pool is exhausted
     */
    private boolean blockWhenExhausted = true;
} 