package com.iwhalecloud.byai.gateway.sandbox.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.core.StringRedisTemplate;

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

@Configuration
@EnableConfigurationProperties(SandboxProperties.class)
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

}
