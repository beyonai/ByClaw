package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.listener;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.DingtalkChannelService;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.*;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.cards.DingtalkCardService;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.config.DingtalkStreamProperties;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.support.DingtalkCallbackMessageParser;
import com.iwhalecloud.byai.state.domain.index.service.IndexService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.FactoryBean;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.Mockito.mock;

class DingtalkBotWiringTest {
    @Test
    void channelCanDependOnTheRobotRegistryWithoutCausingAConstructionCycle() {
        try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext()) {
            var beans = context.getBeanFactory();
            beans.registerSingleton("mapper", new ObjectMapper());
            beans.registerSingleton("users", mock(DingtalkUserService.class));
            beans.registerSingleton("files", mock(DingtalkFileDownloadService.class));
            beans.registerSingleton("replies", mock(DingtalkReplyDispatcher.class));
            beans.registerSingleton("cards", mock(DingtalkCardService.class));
            beans.registerSingleton("parser", mock(DingtalkCallbackMessageParser.class));
            beans.registerSingleton("sessions", mock(DingtalkSessionService.class));
            beans.registerSingleton("properties", new DingtalkStreamProperties());
            beans.registerSingleton("index", mock(IndexService.class));
            // Model the real chat -> employee management -> robot registry -> listener dependency.
            beans.registerSingleton("channel", new FactoryBean<DingtalkChannelService>() {
                @Override
                public DingtalkChannelService getObject() {
                    context.getBean(DingtalkBotListener.class);
                    return mock(DingtalkChannelService.class);
                }

                @Override
                public Class<?> getObjectType() {
                    return DingtalkChannelService.class;
                }
            });
            context.register(DingtalkBotListener.class);

            assertThatCode(context::refresh).doesNotThrowAnyException();
            assertThatCode(() -> context.getBean(DingtalkChannelService.class)).doesNotThrowAnyException();
        }
    }
}
