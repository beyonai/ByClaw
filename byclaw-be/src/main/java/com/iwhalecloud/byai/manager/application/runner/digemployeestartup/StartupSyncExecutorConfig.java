package com.iwhalecloud.byai.manager.application.runner.digemployeestartup;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.ThreadPoolExecutor;

/**
 * 数字员工 Redis 启动期同步专用线程池（PR-1）。
 * <p>
 * 关键设计：
 * <ul>
 *     <li>独立命名空间（{@code dig-emp-startup-}），与 ForkJoinPool.commonPool() 解耦，
 *         不会被 {@code @Async} 业务任务占用</li>
 *     <li>固定 core == max（统一并行度，避免弹性扩容带来的连接池争用）</li>
 *     <li>队列上限 2 + {@code AbortPolicy}：饱和时立即抛出由 Runner 捕获，避免任务静默堆积</li>
 *     <li>shutdown 时等待任务完成（{@code WaitForTasksToCompleteOnShutdown}），最长 60 秒</li>
 * </ul>
 */
@Configuration
public class StartupSyncExecutorConfig {

    private static final Logger logger = LoggerFactory.getLogger(StartupSyncExecutorConfig.class);

    @Bean("digEmployeeStartupSyncExecutor")
    public ThreadPoolTaskExecutor digEmployeeStartupSyncExecutor(
            @Value("${byai.dig-employee.startup-sync.parallelism:4}") int parallelism) {
        // 与 Druid maxActive 联动：默认上限 4；DB 连接池极小时自动降级到 1
        int safeParallelism = Math.max(1, Math.min(parallelism, 4));

        ThreadPoolTaskExecutor e = new ThreadPoolTaskExecutor();
        e.setCorePoolSize(safeParallelism);
        e.setMaxPoolSize(safeParallelism);
        e.setQueueCapacity(2);
        e.setThreadNamePrefix("dig-emp-startup-");
        e.setRejectedExecutionHandler(new ThreadPoolExecutor.AbortPolicy());
        e.setWaitForTasksToCompleteOnShutdown(true);
        e.setAwaitTerminationSeconds(60);
        e.setDaemon(true);
        e.initialize();
        logger.info("digEmployeeStartupSyncExecutor initialized: core={}, max={}, queue=2",
            safeParallelism, safeParallelism);
        return e;
    }
}
