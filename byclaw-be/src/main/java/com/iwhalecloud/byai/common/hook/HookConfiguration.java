package com.iwhalecloud.byai.common.hook;

import io.micrometer.core.instrument.MeterRegistry;
import java.util.List;
import java.util.concurrent.Executor;
import java.util.concurrent.ThreadPoolExecutor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

@Configuration(proxyBeanMethods = false)
public class HookConfiguration {
    /** 先加载、校验数据库配置，确保无效配置不会分配投递资源。 */
    @Bean
    public HookProperties hookProperties(JdbcTemplate jdbc, ConfigurableEnvironment environment,
        List<HookEventSchema> schemas) {
        HookProperties properties = HookConfigurationLoader.load(jdbc, environment);
        if (properties.isEnabled()) {
            try {
                new HookRequestMapper().validate(properties, schemas);
            } catch (IllegalArgumentException invalid) {
                // 校验器仅输出字段路径；不保留可能携带配置对象的异常因果链。
                throw new IllegalStateException("Invalid " + HookConfigurationLoader.CONFIG_CODE + ": " + invalid.getMessage());
            }
        }
        return properties;
    }

    @Bean
    public HookPublisher hookPublisher(ObjectProvider<HookDispatcher> dispatcher) {
        return new HookPublisher(dispatcher);
    }

    @Bean("hookExecutor")
    public Executor hookExecutor(HookProperties properties) {
        if (!properties.isEnabled()) {
            return null;
        }
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(4);
        executor.setQueueCapacity(100);
        executor.setThreadNamePrefix("outbound-hook-");
        // TTL extends InheritableThreadLocal; a plain executor would retain its first caller's identity.
        executor.setThreadFactory(Thread.ofPlatform().name("outbound-hook-", 0)
            .inheritInheritableThreadLocals(false).factory());
        // Saturation must never move HTTP work onto the registration request thread.
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.AbortPolicy());
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(10);
        return executor;
    }

    @Bean(destroyMethod = "close")
    public HookDispatcher hookDispatcher(HookProperties properties, List<HookEventSchema> schemas,
        @Qualifier("hookExecutor") ObjectProvider<Executor> executor, ObjectProvider<MeterRegistry> meters) {
        if (!properties.isEnabled()) {
            return null;
        }
        return new HookDispatcher(properties, schemas, executor.getObject(), meters.getIfAvailable());
    }
}
