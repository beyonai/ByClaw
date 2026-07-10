package com.iwhalecloud.byai.gateway.channels.service.feishu;

import com.iwhalecloud.byai.gateway.channels.service.feishu.config.FeishuStreamProperties;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * 应用启动时注册飞书机器人长连接。
 */
@Component
public class FeishuRobotLifecycle {

    private static final Logger logger = LoggerFactory.getLogger(FeishuRobotLifecycle.class);

    private final FeishuStreamProperties properties;
    private final FeishuRobotRegistryService feishuRobotRegistryService;

    public FeishuRobotLifecycle(
            FeishuStreamProperties properties,
            FeishuRobotRegistryService feishuRobotRegistryService
    ) {
        this.properties = properties;
        this.feishuRobotRegistryService = feishuRobotRegistryService;
    }

    @PostConstruct
    public void init() {
        if (!properties.isEnabled()) {
            logger.info("Feishu long-connection bot is disabled. Set channel.stream.enabled=true to enable it.");
            return;
        }
        try {
            feishuRobotRegistryService.initializeRobotClients();
        } catch (Exception e) {
            logger.warn("Initialize Feishu long-connection robot clients failed", e);
        }
    }
}
