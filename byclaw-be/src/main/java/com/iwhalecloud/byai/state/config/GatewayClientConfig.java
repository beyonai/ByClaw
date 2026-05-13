package com.iwhalecloud.byai.state.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import com.iwhaleai.byai.framework.client.GatewayClient;
import com.iwhaleai.byai.framework.common.RedisClient;
import com.iwhaleai.byai.framework.core.WorkerRegistry;

import java.util.ArrayList;

/**
 * Gateway SDK 客户端配置。
 * 复用项目已有的 Redis 连接参数，避免为 Gateway 单独维护一套配置。
 */
@Configuration
public class GatewayClientConfig {

    private static final Logger logger = LoggerFactory.getLogger(GatewayClientConfig.class);

    @Value("${spring.redis.host:localhost}")
    private String redisHost;

    @Value("${spring.redis.port:6379}")
    private int redisPort;

    @Value("${spring.redis.database:0}")
    private int redisDatabase;

    @Value("${spring.redis.username:}")
    private String redisUsername;

    @Value("${spring.redis.password:}")
    private String redisPassword;

    @Bean
    public RedisClient gatewayRedisClient() {
        logger.info("初始化 Gateway SDK RedisClient, host: {}, port: {}, db: {}", redisHost, redisPort, redisDatabase);
        String username = (redisUsername != null && !redisUsername.isEmpty()) ? redisUsername : null;
        String password = (redisPassword != null && !redisPassword.isEmpty()) ? redisPassword : null;
        return new RedisClient(redisHost, redisPort, redisDatabase, username, password);
    }

    @Bean
    public WorkerRegistry gatewayWorkerRegistry(RedisClient gatewayRedisClient) {
        logger.info("初始化 Gateway SDK WorkerRegistry");
        return new WorkerRegistry(gatewayRedisClient);
    }

    @Bean
    public GatewayClient<?> gatewayClient(RedisClient gatewayRedisClient, WorkerRegistry gatewayWorkerRegistry) {
        logger.info("初始化 GatewayClient");
        return new GatewayClient<>(gatewayRedisClient, gatewayWorkerRegistry, new ArrayList());
    }
}
