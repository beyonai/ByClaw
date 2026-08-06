package com.iwhalecloud.byai.manager.config;

import java.util.concurrent.Executor;
import java.util.concurrent.ThreadPoolExecutor;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import lombok.extern.slf4j.Slf4j;

/**
 * 异步执行配置
 *
 * 为项目初始化等长时间运行的操作提供异步执行能力
 */
@Slf4j
@Configuration
@EnableAsync
public class AsyncConfig {

    /**
     * 项目初始化任务执行器
     *
     * 用于执行项目初始化的主要工作流程
     */
    @Bean("projectInitExecutor")
    public Executor projectInitExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();

        // 核心线程数（常驻）
        executor.setCorePoolSize(2);

        // 最大线程数
        executor.setMaxPoolSize(10);

        // 队列容量（等待队列）
        executor.setQueueCapacity(100);

        // 线程空闲存活时间（秒）
        executor.setKeepAliveSeconds(300);

        // 线程名称前缀
        executor.setThreadNamePrefix("project-init-");

        // 拒绝策略：由调用线程执行（避免丢失任务）
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.AbortPolicy());

        // 等待任务完成后再关闭线程池
        executor.setWaitForTasksToCompleteOnShutdown(true);

        // 最多等待 60 秒
        executor.setAwaitTerminationSeconds(60);

        executor.initialize();

        log.info("Initialized projectInitExecutor: corePoolSize={}, maxPoolSize={}, queueCapacity={}",
            executor.getCorePoolSize(), executor.getMaxPoolSize(), executor.getQueueCapacity());

        return executor;
    }

    /**
     * 审计日志执行器
     *
     * 用于异步写入审计日志，不阻塞主流程
     */
    @Bean("auditLogExecutor")
    public Executor auditLogExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();

        // 核心线程数（审计日志写入量较小）
        executor.setCorePoolSize(2);

        // 最大线程数
        executor.setMaxPoolSize(5);

        // 队列容量（较大，确保审计日志不丢失）
        executor.setQueueCapacity(500);

        // 线程空闲存活时间（秒）
        executor.setKeepAliveSeconds(600);

        // 线程名称前缀
        executor.setThreadNamePrefix("audit-log-");

        // 拒绝策略：由调用线程执行（确保审计日志不丢失）
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());

        // 等待任务完成后再关闭线程池
        executor.setWaitForTasksToCompleteOnShutdown(true);

        // 最多等待 30 秒
        executor.setAwaitTerminationSeconds(30);

        executor.initialize();

        log.info("Initialized auditLogExecutor: corePoolSize={}, maxPoolSize={}, queueCapacity={}",
            executor.getCorePoolSize(), executor.getMaxPoolSize(), executor.getQueueCapacity());

        return executor;
    }
}
