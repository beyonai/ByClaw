package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.listener;

import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.DingtalkRobotRegistryService;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.config.DingtalkStreamProperties;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.scheduling.annotation.Scheduled;

import java.util.concurrent.TimeUnit;

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
            logger.info("DingTalk stream bot is disabled. Set channel.stream.enabled=true to enable it.");
            return;
        }
        try {
            dingtalkRobotRegistryService.initializeRobotClients();
        } catch (Exception e) {
            logger.error("Failed to initialize DingTalk robot clients during application startup", e);
        }
    }

    @Scheduled(
            fixedDelayString = "${channel.stream.lifecycle.reconciliation-delay-seconds:60}",
            timeUnit = TimeUnit.SECONDS
    )
    public void reconcile() {
        if (!properties.isEnabled()) {
            return;
        }
        try {
            dingtalkRobotRegistryService.reconcileRobotClients();
        } catch (Exception e) {
            logger.error("Failed to reconcile DingTalk robot clients", e);
        }
    }
}
