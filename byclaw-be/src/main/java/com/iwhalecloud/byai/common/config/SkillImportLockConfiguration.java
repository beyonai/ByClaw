package com.iwhalecloud.byai.common.config;

import org.springframework.beans.factory.DisposableBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.integration.redis.util.RedisLockRegistry;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

/** 锁租约交给 Spring Integration 管理，不依赖数据库方言或自定义锁脚本。 */
@Configuration
public class SkillImportLockConfiguration implements DisposableBean {

    private final ThreadPoolTaskScheduler renewalScheduler = new ThreadPoolTaskScheduler();

    @Bean
    public RedisLockRegistry skillImportLockRegistry(RedisConnectionFactory connectionFactory) {
        renewalScheduler.setThreadNamePrefix("skill-import-lock-renewal-");
        renewalScheduler.setDaemon(true);
        renewalScheduler.initialize();
        RedisLockRegistry registry = new RedisLockRegistry(connectionFactory, "BYAI:SKILL:IMPORT", 60_000L);
        registry.setRenewalTaskScheduler(renewalScheduler);
        return registry;
    }

    @Override
    public void destroy() {
        renewalScheduler.shutdown();
    }
}
