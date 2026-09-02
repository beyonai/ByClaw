package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream;

import com.alibaba.fastjson2.JSON;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.config.DingtalkStreamProperties;
import com.iwhalecloud.byai.manager.application.service.digitemploy.event.DigEmployeeChangeEvent;
import com.iwhalecloud.byai.manager.application.service.digitemploy.event.DigEmployeeChangeEventType;
import com.iwhalecloud.byai.manager.application.service.digitemploy.event.DigEmployeeChangeNotifyProperties;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.connection.Message;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;

/**
 * Re-reads committed DingTalk robot configuration when another backend instance publishes a digital employee change.
 */
@Component
public class DingtalkRobotChangeSubscriber implements MessageListener {

    private static final Logger logger = LoggerFactory.getLogger(DingtalkRobotChangeSubscriber.class);

    private final RedisMessageListenerContainer listenerContainer;
    private final DigEmployeeChangeNotifyProperties notifyProperties;
    private final DingtalkStreamProperties streamProperties;
    private final DingtalkRobotRegistryService registryService;
    private ChannelTopic topic;

    public DingtalkRobotChangeSubscriber(
            RedisMessageListenerContainer listenerContainer,
            DigEmployeeChangeNotifyProperties notifyProperties,
            DingtalkStreamProperties streamProperties,
            DingtalkRobotRegistryService registryService) {
        this.listenerContainer = listenerContainer;
        this.notifyProperties = notifyProperties;
        this.streamProperties = streamProperties;
        this.registryService = registryService;
    }

    @PostConstruct
    public void subscribe() {
        if (!streamProperties.isEnabled()) {
            return;
        }
        topic = new ChannelTopic(notifyProperties.getPubsubChannel());
        listenerContainer.addMessageListener(this, topic);
    }

    @PreDestroy
    public void unsubscribe() {
        if (topic != null) {
            listenerContainer.removeMessageListener(this, topic);
        }
    }

    @Override
    public void onMessage(Message message, byte[] pattern) {
        try {
            DigEmployeeChangeEvent event = JSON.parseObject(
                    new String(message.getBody(), StandardCharsets.UTF_8),
                    DigEmployeeChangeEvent.class
            );
            if (event == null || event.getResourceId() == null || event.getEventType() == null) {
                return;
            }
            route(event.getEventType(), event.getResourceId());
        } catch (RuntimeException e) {
            logger.warn("Ignore invalid digital employee change event for DingTalk Stream", e);
        }
    }

    private void route(DigEmployeeChangeEventType eventType, Long resourceId) {
        switch (eventType) {
            case DIG_EMPLOYEE_CREATED -> registryService.registerRobotClientsForResource(resourceId);
            case DIG_EMPLOYEE_UPDATED -> registryService.refreshRobotClientsForResource(resourceId);
            case DIG_EMPLOYEE_DELETED -> registryService.unregisterRobotClientsForResource(resourceId);
            default -> {
                // Skill-only changes do not affect DingTalk Stream runtime configuration.
            }
        }
    }
}
