package com.iwhalecloud.byai.manager.application.service.auth;

import java.util.concurrent.Executor;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/**
 * 授权Redis同步异步线程池。
 */
@Configuration
public class AuthRedisSyncAsyncConfig {

    public static final String AUTH_REDIS_SYNC_EXECUTOR = "authRedisSyncExecutor";

    @Bean(name = AUTH_REDIS_SYNC_EXECUTOR)
    public Executor authRedisSyncExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(4);
        executor.setMaxPoolSize(8);
        executor.setQueueCapacity(512);
        executor.setKeepAliveSeconds(60);
        executor.setThreadNamePrefix("auth-redis-sync-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(10);
        executor.initialize();
        return executor;
    }
}
