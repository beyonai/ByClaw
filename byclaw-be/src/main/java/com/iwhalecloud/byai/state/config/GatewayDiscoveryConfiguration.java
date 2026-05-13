package com.iwhalecloud.byai.state.config;

import com.iwhaleai.byai.framework.common.RedisClient;
import com.iwhaleai.byai.framework.core.discovery.ServiceRegistry;
import com.iwhaleai.byai.framework.config.GatewayConfig;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.web.servlet.context.ServletWebServerInitializedEvent;
import org.springframework.context.ApplicationListener;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.HashMap;
import java.util.Map;

/**
 * Spring Boot 集成 SDK 服务注册与发现配置。
 *
 * 1. 动态端口捕获：支持 server.port=0 情况，监听 ServletWebServerInitializedEvent 获取真实端口。
 * 2. 显式生命周期管理：解决 DevTools 重启导致的 "Pool not open" 问题。
 *    原因：RedisClient 在 SDK 中是静态单例，Spring 销毁旧 Context 时会关闭连接池，
 *    重启后的新 Context 获取到的仍是旧的已关闭单例。
 *    解决方法：通过 RedisClient.init() 强制重新初始化。
 * 3. 灵活网络配置：引入 gateway.discovery.host 支持手动指定注册 Host，适配 Docker/NAT 环境。
 */
@Slf4j
@Configuration
public class GatewayDiscoveryConfiguration implements ApplicationListener<ServletWebServerInitializedEvent> {

    @Value("${spring.application.name:beclaw-be}")
    private String serviceName;

    @Value("${gateway.discovery.host:#{null}}")
    private String discoveryHost;

    @Value("${gateway.discovery.port:#{null}}")
    private Integer actualServerPort;

    @Override
    public void onApplicationEvent(ServletWebServerInitializedEvent event) {
        // 捕获 Web 容器启动后的真实端口
        if (this.actualServerPort == null) {
            this.actualServerPort = event.getWebServer().getPort();
            log.info(">>> 检测到应用运行时端口: {}", actualServerPort);
        }
        if ("AUTO".equalsIgnoreCase(this.discoveryHost)) {
            this.discoveryHost = null;
        }
    }

    /**
     * 将 RedisClient 注册为 Bean。
     * 特别注意：这里调用 RedisClient.init() 而非 getInstance()，以确保在 DevTools 环境下重启时重置连接池。
     */
    @Bean(destroyMethod = "close")
    public RedisClient redisClient() {
        log.info(">>> 初始化 RedisClient Bean (强制重新连接池)...");
        RedisClient.init(
                GatewayConfig.get("REDIS_HOST", "localhost"),
                GatewayConfig.getInt("REDIS_PORT", 6379),
                GatewayConfig.getInt("REDIS_DATABASE", 0),
                GatewayConfig.get("REDIS_USERNAME"),
                GatewayConfig.get("REDIS_PASSWORD"),
                GatewayConfig.getInt("REDIS_TIMEOUT", 5000)
        );
        return RedisClient.getInstance();
    }

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
    public ApplicationRunner serviceRegistrationRunner(ServiceRegistry registry) {
        return args -> {
            Map<String, Object> metadata = new HashMap<>();
            metadata.put("framework", "spring-boot");
            metadata.put("version", "3.2.0");

            log.info(">>> 正在向注册中心注册服务: {} (Host: {}, Port: {})",
                     serviceName, discoveryHost != null ? discoveryHost : "AUTO", actualServerPort);

            // 注册服务
            registry.register(serviceName, discoveryHost, actualServerPort, 1, metadata, 5);
            log.info(">>> 服务注册成功，实例 ID: {}", registry.getCurrentInstance().getId());
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
                } catch (Exception e) {
                    log.warn("<<< 服务注销失败 (可能连接池已关闭): {}", e.getMessage());
                }
            }
        }
    }
}
