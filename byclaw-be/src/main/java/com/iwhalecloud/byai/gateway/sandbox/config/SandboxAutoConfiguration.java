package com.iwhalecloud.byai.gateway.sandbox.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import com.iwhalecloud.byai.common.feign.client.FeignWhaleAgentService;
import com.iwhalecloud.byai.common.storage.constants.StorageType;
import com.iwhalecloud.byai.gateway.sandbox.client.OpenSandboxClient;
import com.iwhalecloud.byai.gateway.sandbox.runtime.OpenSandboxRuntimeProvider;
import com.iwhalecloud.byai.gateway.sandbox.runtime.SandboxRuntimeProvider;
import com.iwhalecloud.byai.gateway.sandbox.runtime.StandardSandboxLifecycleService;
import com.iwhalecloud.byai.gateway.sandbox.runtime.WhaleAgentSandboxRuntimeProvider;
import com.iwhalecloud.byai.gateway.sandbox.service.EnvTemplateRenderer;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxLifecycleFacade;
import com.iwhalecloud.byai.gateway.sandbox.spec.GenericSandboxSpecProcessor;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpecRepository;
import com.iwhalecloud.byai.gateway.sandbox.workspace.SandboxWorkspaceBootstrapInitializer;
import com.iwhalecloud.byai.manager.domain.connector.provider.lark.LarkAuthorizationProperties;

@Configuration
@EnableConfigurationProperties({SandboxProperties.class, LarkAuthorizationProperties.class})
public class SandboxAutoConfiguration {

    @Bean
    public OpenSandboxClient openSandboxClient(SandboxProperties properties) {
        return new OpenSandboxClient(properties);
    }

    @Bean
    public GenericSandboxSpecProcessor genericSandboxSpecProcessor(
        SandboxWorkspaceBootstrapInitializer bootstrapInitializer) {
        return new GenericSandboxSpecProcessor(bootstrapInitializer);
    }

    @Bean
    public SandboxLifecycleFacade sandboxLifecycleFacade(
        SandboxProperties properties,
        StringRedisTemplate stringRedisTemplate,
        GenericSandboxSpecProcessor specProcessor,
        SandboxServiceSpecRepository sandboxServiceSpecRepository,
        FeignWhaleAgentService feignWhaleAgentService,
        OpenSandboxClient openSandboxClient,
        @Value("${file.storage.type:minio}") String storageType) {
        SandboxRuntimeProvider provider;
        if (StorageType.WHALE_AGENT.equalsIgnoreCase(storageType)) {
            provider = new WhaleAgentSandboxRuntimeProvider(feignWhaleAgentService);
        } else {
            provider = new OpenSandboxRuntimeProvider(openSandboxClient, properties);
        }
        return new StandardSandboxLifecycleService(properties, stringRedisTemplate,
            sandboxServiceSpecRepository, specProcessor, provider);
    }

    @Bean
    public EnvTemplateRenderer envTemplateRenderer() {
        return new EnvTemplateRenderer();
    }

    @Bean(name = "sandboxWakeupStreamExecutor")
    public ThreadPoolTaskExecutor sandboxWakeupStreamExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(1);
        executor.setMaxPoolSize(4);
        executor.setQueueCapacity(32);
        executor.setKeepAliveSeconds(60);
        executor.setThreadNamePrefix("sandbox-wakeup-stream-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(10);
        executor.initialize();
        return executor;
    }

    /**
     * DSH 活动 Stream 的轮询任务长期占用一个线程。必须与 sandboxWakeupStreamExecutor 分开：ThreadPoolTaskExecutor
     * 只在队列满时才扩线程，共用一个 core=1 且带队列的池时，第二个轮询任务会一直排队得不到线程。这里只有一个订阅，
     * 按单线程、无队列配置，再注册订阅会直接被拒绝而不是静默排队。
     */
    @Bean(name = "dshActivityStreamExecutor")
    public ThreadPoolTaskExecutor dshActivityStreamExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(1);
        executor.setMaxPoolSize(1);
        executor.setQueueCapacity(0);
        executor.setKeepAliveSeconds(60);
        executor.setThreadNamePrefix("dsh-activity-stream-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(10);
        executor.initialize();
        return executor;
    }

}
