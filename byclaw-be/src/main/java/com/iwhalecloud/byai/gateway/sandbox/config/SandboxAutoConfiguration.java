package com.iwhalecloud.byai.gateway.sandbox.config;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
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
import com.iwhalecloud.byai.gateway.sandbox.runtime.SharedDshHostClient;
import com.iwhalecloud.byai.gateway.sandbox.runtime.SharedDshHostContexts;
import com.iwhalecloud.byai.gateway.sandbox.runtime.StandardSandboxLifecycleService;
import com.iwhalecloud.byai.gateway.sandbox.runtime.WhaleAgentSandboxRuntimeProvider;
import com.iwhalecloud.byai.gateway.sandbox.service.EnvTemplateRenderer;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxLifecycleFacade;
import com.iwhalecloud.byai.gateway.sandbox.spec.GenericSandboxSpecProcessor;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpecRepository;
import com.iwhalecloud.byai.gateway.sandbox.workspace.SandboxWorkspaceBootstrapInitializer;
import com.iwhalecloud.byai.manager.domain.connector.provider.lark.LarkAuthorizationProperties;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;

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
        @Value("${file.storage.type:minio}") String storageType,
        com.iwhalecloud.byai.gateway.sandbox.platform.PlatformRemoteGateway platformGateway,
        ObjectProvider<ByaiSystemConfigService> systemConfigService) {
        SandboxRuntimeProvider provider;
        if (StorageType.WHALE_AGENT.equalsIgnoreCase(storageType)) {
            provider = new WhaleAgentSandboxRuntimeProvider(feignWhaleAgentService);
        } else {
            provider = new OpenSandboxRuntimeProvider(openSandboxClient, properties);
        }
        return com.iwhalecloud.byai.gateway.sandbox.platform.PlatformInterfaceRouting.create(SandboxLifecycleFacade.class,
            new StandardSandboxLifecycleService(properties, stringRedisTemplate, sandboxServiceSpecRepository, specProcessor, provider), platformGateway, true);
    }

    /**
     * The resident (shared) DSH host's user contexts, in both execution modes. Absent unless
     * {@code byclaw.sandbox.shared-dsh-host.base-url} is set. A context starts with the environment a
     * {@code byclaw-dsh} sandbox would get, rendered here from the spec; the factory is resolved lazily
     * because it depends on {@code SandboxService}, which depends on this bean.
     */
    @Bean
    @ConditionalOnProperty(prefix = "byclaw.sandbox.shared-dsh-host", name = "base-url")
    public SharedDshHostContexts sharedDshHostContexts(
        SandboxProperties properties,
        GenericSandboxSpecProcessor specProcessor,
        SandboxServiceSpecRepository sandboxServiceSpecRepository,
        ObjectProvider<com.iwhalecloud.byai.gateway.sandbox.service.SandboxLaunchContextFactory> launchContextFactory,
        ObjectProvider<ByaiSystemConfigService> systemConfigService) {
        SandboxProperties.SharedDshHostConfig sharedDshHost = properties.getSharedDshHost();
        String dshType = com.iwhalecloud.byai.gateway.sandbox.service.SandboxLaunchRouting.BYCLAW_DSH_SANDBOX_TYPE;
        java.util.function.Function<String, java.util.Map<String, String>> launchEnv = userCode -> {
            com.iwhalecloud.byai.gateway.sandbox.service.SandboxLaunchContext context = launchContextFactory.getObject()
                .buildContext(userCode, com.iwhalecloud.byai.gateway.sandbox.service.SandboxLaunchRouting.DEFAULT_RESOURCE_ID, dshType);
            com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpec spec = sandboxServiceSpecRepository
                .findByServiceKey(context.getSandboxType())
                .orElseThrow(() -> new IllegalStateException("Unknown sandbox service key: " + context.getSandboxType()));
            java.util.Map<String, String> env = new java.util.LinkedHashMap<>();
            java.util.Map<String, String> rendered = specProcessor
                .buildCreateRequest(userCode, context.getSandboxType(), context.getEnvs(), context.getUserInfo(), spec).getEnv();
            if (rendered != null) env.putAll(rendered);
            // Same system keys the standard lifecycle carries over from the launch environment.
            for (String key : new String[] {"BYAI_SERVICE_BASE_URL", "BYAI_WORKER_ID"}) {
                String value = context.getEnvs() == null ? null : context.getEnvs().get(key);
                if (StringUtils.isNotBlank(value)) env.put(key, value);
            }
            env.putIfAbsent("BYAI_WORKER_ID", SharedDshHostContexts.sharedSandboxId(userCode));
            return env;
        };
        java.util.concurrent.ExecutorService prewarm = java.util.concurrent.Executors.newSingleThreadExecutor(runnable -> {
            Thread thread = new Thread(runnable, "shared-dsh-host-prewarm");
            thread.setDaemon(true);
            return thread;
        });
        return new SharedDshHostContexts(new SharedDshHostClient(sharedDshHost),
            StringUtils.defaultIfBlank(sharedDshHost.getWebBaseUrl(), sharedDshHost.getBaseUrl()),
            SharedDshHostContexts.userFilter(() -> {
                ByaiSystemConfigService service = systemConfigService.getIfAvailable();
                return service == null ? null : service.getDcSystemConfigValueByCode(SharedDshHostContexts.USERS_PARAM);
            }), launchEnv, prewarm);
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
