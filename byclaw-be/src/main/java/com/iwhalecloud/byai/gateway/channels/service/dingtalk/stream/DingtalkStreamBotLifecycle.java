package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

@Component
public class DingtalkStreamBotLifecycle {

    private static final Logger logger = LoggerFactory.getLogger(DingtalkStreamBotLifecycle.class);
    public static final String BOT_MESSAGE_TOPIC = "/v1.0/im/bot/messages/get";

    private final DingtalkStreamProperties properties;
    private final DingtalkRobotRegistryService dingtalkRobotRegistryService;

    public DingtalkStreamBotLifecycle(
            DingtalkStreamProperties properties,
            DingtalkRobotRegistryService dingtalkRobotRegistryService) {
        this.properties = properties;
        this.dingtalkRobotRegistryService = dingtalkRobotRegistryService;
    }

    @PostConstruct
    public void start() {
        if (!properties.isEnabled()) {
            logger.info("DingTalk stream bot is disabled. Set dingtalk.stream.enabled=true to enable it.");
            return;
        }
        try {
            dingtalkRobotRegistryService.initializeRobotClients();
        } catch (Exception e) {
            logger.error("Failed to initialize DingTalk robot clients during application startup", e);
        }
    }
}
