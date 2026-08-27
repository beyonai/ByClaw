package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream;

import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.config.DingtalkStreamProperties;
import com.iwhalecloud.byai.manager.application.service.digitemploy.event.DigEmployeeChangeNotifyProperties;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.DefaultMessage;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;

import java.nio.charset.StandardCharsets;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

class DingtalkRobotChangeSubscriberTest {

    @Test
    void routesSupportedRemoteEventsToIdempotentRegistryOperations() {
        DingtalkStreamProperties streamProperties = new DingtalkStreamProperties();
        streamProperties.setEnabled(true);
        DigEmployeeChangeNotifyProperties notifyProperties = new DigEmployeeChangeNotifyProperties();
        DingtalkRobotRegistryService registry = mock(DingtalkRobotRegistryService.class);
        DingtalkRobotChangeSubscriber subscriber = new DingtalkRobotChangeSubscriber(
                mock(RedisMessageListenerContainer.class), notifyProperties, streamProperties, registry);

        subscriber.onMessage(message("DIG_EMPLOYEE_CREATED", 1001L), null);
        subscriber.onMessage(message("DIG_EMPLOYEE_UPDATED", 1002L), null);
        subscriber.onMessage(message("DIG_EMPLOYEE_DELETED", 1003L), null);
        subscriber.onMessage(message("DIG_EMPLOYEE_SKILLS_SYNCED", 1004L), null);

        verify(registry).registerRobotClientsForResource(1001L);
        verify(registry).refreshRobotClientsForResource(1002L);
        verify(registry).unregisterRobotClientsForResource(1003L);
        verify(registry, never()).refreshRobotClientsForResource(1004L);
    }

    @Test
    void ignoresMalformedPayload() {
        DingtalkRobotRegistryService registry = mock(DingtalkRobotRegistryService.class);
        DingtalkRobotChangeSubscriber subscriber = new DingtalkRobotChangeSubscriber(
                mock(RedisMessageListenerContainer.class),
                new DigEmployeeChangeNotifyProperties(),
                new DingtalkStreamProperties(),
                registry);

        subscriber.onMessage(new DefaultMessage("channel".getBytes(StandardCharsets.UTF_8), "not-json".getBytes(StandardCharsets.UTF_8)), null);

        verify(registry, never()).refreshRobotClientsForResource(org.mockito.ArgumentMatchers.anyLong());
    }

    private DefaultMessage message(String eventType, Long resourceId) {
        String body = "{\"eventType\":\"%s\",\"resourceId\":%d}".formatted(eventType, resourceId);
        return new DefaultMessage("channel".getBytes(StandardCharsets.UTF_8), body.getBytes(StandardCharsets.UTF_8));
    }
}
