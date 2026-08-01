package com.iwhalecloud.byai.manager.application.service.devloop;

import java.util.concurrent.Executor;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/**
 * 集成测试执行异步线程池。测试执行是分钟级长任务,点击后台跑、前端轮询。
 * 队列小、拒绝时抛出:执行并发压满环境不可取,宁可让触发方拿到失败也不无限排队。
 */
@Configuration
public class IntegrationRunAsyncConfig {

    // 注意:不能叫 integrationRunExecutor,会和 @Service IntegrationRunExecutor 的默认 bean 名撞车,
    // 线程池会覆盖掉那个业务组件,导致按类型注入 IntegrationRunExecutor 时 "bean not found"。
    public static final String INTEGRATION_RUN_EXECUTOR = "integrationRunTaskExecutor";

    @Bean(name = INTEGRATION_RUN_EXECUTOR)
    public Executor integrationRunExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(4);
        executor.setQueueCapacity(16);
        executor.setKeepAliveSeconds(60);
        executor.setThreadNamePrefix("devloop-integration-run-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(30);
        executor.initialize();
        return executor;
    }
}
