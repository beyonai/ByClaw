package com.iwhalecloud.byai.common.hook;

import io.micrometer.core.instrument.MeterRegistry;
import java.util.List;
import java.util.concurrent.ThreadPoolExecutor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

@Configuration(proxyBeanMethods = false)
public class HookConfiguration {
    @Bean
    public HookPublisher hookPublisher(ObjectProvider<HookDispatcher> dispatcher) {
        return new HookPublisher(dispatcher);
    }

    /** No binding of URL/credential placeholders and no worker allocation when disabled. */
    @Configuration(proxyBeanMethods = false)
    @ConditionalOnProperty(prefix = "byclaw.hooks", name = "enabled", havingValue = "true")
    @EnableConfigurationProperties(HookProperties.class)
    static class EnabledHooks {
        @Bean("hookExecutor")
        public ThreadPoolTaskExecutor hookExecutor() {
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
            @Qualifier("hookExecutor") ThreadPoolTaskExecutor executor, ObjectProvider<MeterRegistry> meters) {
            return new HookDispatcher(properties, schemas, executor, meters.getIfAvailable());
        }
    }
}
