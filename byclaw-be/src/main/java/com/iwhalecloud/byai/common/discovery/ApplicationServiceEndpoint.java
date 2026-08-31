package com.iwhalecloud.byai.common.discovery;

import java.util.Map;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.servlet.context.ServletWebServerInitializedEvent;
import org.springframework.context.ApplicationListener;
import org.springframework.stereotype.Component;
import org.springframework.web.util.UriComponentsBuilder;

import com.iwhaleai.byai.framework.core.discovery.ServiceInstance;
import com.iwhaleai.byai.framework.core.discovery.ServiceRegistry;

/**
 * 管理当前应用向 by-framework 注册的服务端点，并提供包含应用上下文路径的访问地址。
 */
@Component
public class ApplicationServiceEndpoint implements ApplicationListener<ServletWebServerInitializedEvent> {

    private final ServiceRegistry serviceRegistry;

    @Value("${spring.application.name:beclaw-be}")
    private String serviceName;

    @Value("${gateway.discovery.host:#{null}}")
    private String discoveryHost;

    @Value("${gateway.discovery.port:#{null}}")
    private Integer actualServerPort;

    @Value("${server.servlet.context-path:}")
    private String contextPath;

    public ApplicationServiceEndpoint(ServiceRegistry serviceRegistry) {
        this.serviceRegistry = serviceRegistry;
    }

    @Override
    public void onApplicationEvent(ServletWebServerInitializedEvent event) {
        // 配置未指定注册端口时，使用 Web 容器实际监听的端口，兼容 server.port=0。
        if (actualServerPort == null) {
            actualServerPort = event.getWebServer().getPort();
        }
    }

    /**
     * 使用统一维护的地址和端口注册当前应用实例。
     * 注册信息保持不设置 pathPrefix，由既有调用方自行处理服务上下文路径。
     */
    public void register(Map<String, Object> metadata) {
        serviceRegistry.register(serviceName, resolveDiscoveryHost(), requireServerPort(), 1, metadata, 5);
    }

    /**
     * 根据 by-framework 中的当前注册实例和应用上下文路径生成沙箱访问本应用的基础地址。
     */
    public String getBaseUrl() {
        ServiceInstance instance = serviceRegistry.getCurrentInstance();
        if (instance == null) {
            throw new IllegalStateException("当前应用尚未向 by-framework 注册服务实例");
        }

        return UriComponentsBuilder.newInstance()
            .scheme(instance.getProtocol())
            .host(instance.getHost())
            .port(instance.getPort())
            .path(normalizeContextPath(contextPath))
            .build()
            .toUriString();
    }

    public String getServiceName() {
        return serviceName;
    }

    private String resolveDiscoveryHost() {
        return "AUTO".equalsIgnoreCase(discoveryHost) ? null : discoveryHost;
    }

    private int requireServerPort() {
        if (actualServerPort == null) {
            throw new IllegalStateException("尚未获取应用运行时端口，无法注册服务实例");
        }
        return actualServerPort;
    }

    private String normalizeContextPath(String path) {
        if (StringUtils.isBlank(path) || "/".equals(path.trim())) {
            return "";
        }
        String normalized = path.trim();
        return normalized.startsWith("/") ? normalized : "/" + normalized;
    }
}
