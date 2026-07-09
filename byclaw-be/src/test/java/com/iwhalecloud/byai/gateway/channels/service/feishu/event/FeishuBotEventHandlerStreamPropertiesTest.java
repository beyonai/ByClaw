package com.iwhalecloud.byai.gateway.channels.service.feishu.event;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.channels.enums.ChannelType;
import com.iwhalecloud.byai.gateway.channels.service.ChannelService;
import com.iwhalecloud.byai.gateway.channels.service.ChannelServiceFactory;
import com.iwhalecloud.byai.gateway.channels.service.feishu.FeishuReplyDispatcher;
import com.iwhalecloud.byai.gateway.channels.service.feishu.FeishuSessionService;
import com.iwhalecloud.byai.gateway.channels.service.feishu.FeishuTokenService;
import com.iwhalecloud.byai.gateway.channels.service.feishu.FeishuUserService;
import com.iwhalecloud.byai.gateway.channels.service.feishu.config.FeishuStreamProperties;
import com.iwhalecloud.byai.gateway.channels.service.feishu.model.FeishuCallbackMessage;
import com.iwhalecloud.byai.gateway.channels.service.feishu.support.FeishuCallbackMessageParser;
import com.iwhalecloud.byai.manager.vo.index.AuthDigitEmployVo;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.index.service.IndexService;
import java.io.OutputStream;
import java.lang.reflect.Field;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class FeishuBotEventHandlerStreamPropertiesTest {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private ChannelService previousFeishuChannelService;

    @AfterEach
    void tearDown() throws Exception {
        if (previousFeishuChannelService == null) {
            channelServiceMap().remove(ChannelType.FEISHU);
        } else {
            channelServiceMap().put(ChannelType.FEISHU, previousFeishuChannelService);
        }
    }

    @Test
    void handleEvent_ignoresCallbackWhenStreamDisabled() throws Exception {
        FeishuStreamProperties streamProperties = new FeishuStreamProperties();
        streamProperties.setEnabled(false);
        streamProperties.setShowReasoning(false);

        FeishuReplyDispatcher replyDispatcher = mock(FeishuReplyDispatcher.class);
        FeishuTokenService tokenService = mock(FeishuTokenService.class);
        FeishuCallbackMessageParser parser = mock(FeishuCallbackMessageParser.class);

        FeishuBotEventHandler handler = new FeishuBotEventHandler(
                objectMapper,
                parser,
                mock(FeishuUserService.class),
                tokenService,
                replyDispatcher,
                mock(FeishuSessionService.class),
                mock(IndexService.class),
                streamProperties
        );

        JsonNode root = objectMapper.readTree("""
                {"header":{"event_type":"im.message.receive_v1","event_id":"evt-1","app_id":"app-1"},"event":{}}
                """);
        handler.handleEvent(root);

        verify(parser, never()).parse(any());
        verify(replyDispatcher, never()).replyTextMessage(any(), any(), any());
        verify(replyDispatcher, never()).replyCardMessage(any(), any(), any(), any());
    }

    @Test
    void replyAssistantMessage_skipsChatAndReplyWhenStreamDisabled() throws Exception {
        FeishuStreamProperties streamProperties = new FeishuStreamProperties();
        streamProperties.setEnabled(false);
        FeishuReplyDispatcher replyDispatcher = mock(FeishuReplyDispatcher.class);
        FeishuTokenService tokenService = mock(FeishuTokenService.class);
        ChannelService channelService = mock(ChannelService.class);
        registerFeishuChannelService(channelService);
        FeishuBotEventHandler handler = new FeishuBotEventHandler(
                objectMapper,
                mock(FeishuCallbackMessageParser.class),
                mock(FeishuUserService.class),
                tokenService,
                replyDispatcher,
                mock(FeishuSessionService.class),
                mock(IndexService.class),
                streamProperties
        );

        ReflectionTestUtils.invokeMethod(
                handler,
                "replyAssistantMessage",
                digitEmploy(),
                new AssistantChatDto(),
                callbackMessage()
        );

        verify(channelService, never()).chat(any(), any(OutputStream.class));
        verify(tokenService, never()).getTenantAccessToken(any());
        verify(replyDispatcher, never()).replyTextMessage(any(), any(), any());
        verify(replyDispatcher, never()).replyCardMessage(any(), any(), any(), any());
    }

    private AuthDigitEmployVo digitEmploy() {
        AuthDigitEmployVo digitEmployVo = new AuthDigitEmployVo();
        digitEmployVo.setId(1001L);
        digitEmployVo.setName("Feishu Agent");
        return digitEmployVo;
    }

    private FeishuCallbackMessage callbackMessage() {
        FeishuCallbackMessage message = new FeishuCallbackMessage();
        message.setAppId("app-1");
        message.setMessageId("msg-1");
        return message;
    }

    private void registerFeishuChannelService(ChannelService channelService) throws Exception {
        previousFeishuChannelService = channelServiceMap().put(ChannelType.FEISHU, channelService);
    }

    @SuppressWarnings("unchecked")
    private Map<ChannelType, ChannelService> channelServiceMap() throws Exception {
        Field field = ChannelServiceFactory.class.getDeclaredField("CHANNEL_SERVICE_MAP");
        field.setAccessible(true);
        return (Map<ChannelType, ChannelService>) field.get(null);
    }
}
