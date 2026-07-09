package com.iwhalecloud.byai.gateway.channels.service.wecom.stream.listener;

import com.iwhalecloud.byai.gateway.channels.service.wecom.stream.WecomRobotRegistryService;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.config.WecomStreamProperties;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Starts WeCom bot connections at application boot, mirroring
 * {@code DingtalkStreamBotLifecycle}. Without this @PostConstruct the registry
 * service does nothing on its own and NO bot ever connects even with
 * {@code channel.stream.enabled=true} (plan §Task 9 / §12 silent zero-start).
 */
@Component
public class WecomStreamBotLifecycle {

    private static final Logger logger = LoggerFactory.getLogger(WecomStreamBotLifecycle.class);

    private final WecomStreamProperties properties;
    private final WecomRobotRegistryService registryService;

    public WecomStreamBotLifecycle(WecomStreamProperties properties,
                                   WecomRobotRegistryService registryService) {
        this.properties = properties;
        this.registryService = registryService;
    }

    @PostConstruct
    public void start() {
        if (!properties.isEnabled()) {
            logger.info("WeCom stream bot is disabled. Set channel.stream.enabled=true to enable it.");
            return;
        }
        try {
            registryService.initializeRobotClients();
        } catch (Exception e) {
            logger.error("Failed to initialize WeCom robot clients during application startup", e);
        }
    }
}
