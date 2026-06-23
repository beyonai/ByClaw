package com.iwhalecloud.byai.gateway.sandbox.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

@Configuration(proxyBeanMethods = false)
public class SandboxJobSchedulerConfiguration {

    public static final String SANDBOX_JOB_TASK_SCHEDULER = "sandboxJobTaskScheduler";

    private static final Logger LOGGER = LoggerFactory.getLogger(SandboxJobSchedulerConfiguration.class);

    @Bean(name = SANDBOX_JOB_TASK_SCHEDULER)
    public ThreadPoolTaskScheduler sandboxJobTaskScheduler() {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(4);
        scheduler.setThreadNamePrefix("sandbox-job-");
        scheduler.setWaitForTasksToCompleteOnShutdown(true);
        scheduler.setAwaitTerminationSeconds(30);
        scheduler.setRemoveOnCancelPolicy(true);
        scheduler.setErrorHandler(error -> LOGGER.error("沙箱定时任务执行异常", error));
        return scheduler;
    }
}
