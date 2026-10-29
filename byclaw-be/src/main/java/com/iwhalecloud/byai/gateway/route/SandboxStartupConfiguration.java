package com.iwhalecloud.byai.gateway.route;

import java.util.concurrent.ThreadPoolExecutor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

@Configuration
public class SandboxStartupConfiguration {
    /** Startup RPCs must never run on the waiting request thread, even under saturation. */
    @Bean("sandboxStartupExecutor")
    public ThreadPoolTaskExecutor sandboxStartupExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(4);
        executor.setMaxPoolSize(32);
        executor.setQueueCapacity(128);
        executor.setThreadNamePrefix("sandbox-startup-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.AbortPolicy());
        return executor;
    }
}
