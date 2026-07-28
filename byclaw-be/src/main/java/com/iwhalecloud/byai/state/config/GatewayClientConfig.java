package com.iwhalecloud.byai.state.config;

import com.iwhaleai.byai.framework.common.RedisConnectionConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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

    @Bean(value = "redisClient", destroyMethod = "close")
    public RedisClient redisClient() {
        logger.info(">>> 初始化 Gateway SDK RedisClient...");
        RedisConnectionConfig config = RedisConnectionConfig.fromEnv();
        logger.info("RedisConnectionConfig={}", config);
        RedisClient.init(config);
        return RedisClient.getInstance();
    }

    @Bean
    public WorkerRegistry gatewayWorkerRegistry(RedisClient redisClient) {
        logger.info("初始化 Gateway SDK WorkerRegistry");
        return new WorkerRegistry(redisClient);
    }

    @Bean
    public GatewayClient<?> gatewayClient(RedisClient redisClient, WorkerRegistry gatewayWorkerRegistry) {
        logger.info("初始化 GatewayClient");
        return new GatewayClient<>(redisClient, gatewayWorkerRegistry, new ArrayList());
    }
}
