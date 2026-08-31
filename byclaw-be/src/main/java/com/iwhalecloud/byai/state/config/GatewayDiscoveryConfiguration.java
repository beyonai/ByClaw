package com.iwhalecloud.byai.state.config;

import java.util.HashMap;
import java.util.Map;

import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import com.iwhaleai.byai.framework.common.RedisClient;
import com.iwhaleai.byai.framework.core.discovery.ServiceRegistry;
import com.iwhalecloud.byai.common.discovery.ApplicationServiceEndpoint;

/**
 * Spring Boot 集成 by-framework 服务注册与发现配置。
 * 注册端点由 {@link ApplicationServiceEndpoint} 统一管理，此处负责创建注册器并管理其生命周期。
 */
@Slf4j
@Configuration
public class GatewayDiscoveryConfiguration {

    /**
     * 将 ServiceRegistry 注册为 Bean。
     */
    @Bean
    public ServiceRegistry serviceRegistry(RedisClient redisClient) {
        return new ServiceRegistry(redisClient);
    }

    /**
     * 启动完成后自动执行服务注册。
     */
    @Bean
    public ApplicationRunner serviceRegistrationRunner(ApplicationServiceEndpoint serviceEndpoint) {
        return args -> {
            Map<String, Object> metadata = new HashMap<>();
            metadata.put("framework", "spring-boot");
            metadata.put("version", "3.2.0");

            log.info(">>> 正在向注册中心注册服务: {}", serviceEndpoint.getServiceName());
            serviceEndpoint.register(metadata);
            log.info(">>> 服务注册成功，访问地址: {}", serviceEndpoint.getBaseUrl());
        };
    }

    /**
     * 管理服务生命周期，通过显式引用 redisClient 确保 Spring 的销毁顺序。
     */
    @Bean
    public ServiceLifecycleManager serviceLifecycleManager(ServiceRegistry registry, RedisClient redisClient) {
        return new ServiceLifecycleManager(registry);
    }

    public static class ServiceLifecycleManager {
        private final ServiceRegistry registry;

        public ServiceLifecycleManager(ServiceRegistry registry) {
            this.registry = registry;
        }

        @PreDestroy
        public void shutdown() {
            if (registry != null && registry.getCurrentInstance() != null) {
                log.info("<<< 正在注销服务实例: {} ...", registry.getCurrentInstance().getId());
                try {
                    registry.unregister();
                    log.info("<<< 服务已从注册中心下线。");
                }
                catch (Exception e) {
                    log.warn("<<< 服务注销失败 (可能连接池已关闭): {}", e.getMessage());
                }
            }
        }
    }
}
