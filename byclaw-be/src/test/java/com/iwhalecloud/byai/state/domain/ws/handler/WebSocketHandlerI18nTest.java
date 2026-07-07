package com.iwhalecloud.byai.state.domain.ws.handler;

import java.util.Locale;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.state.domain.notification.service.NotificationService;
import com.iwhalecloud.byai.state.domain.ws.constant.Constant;
import com.iwhalecloud.byai.state.domain.ws.service.ChatService;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import io.netty.channel.embedded.EmbeddedChannel;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;

class WebSocketHandlerI18nTest {

    @AfterEach
    void tearDown() {
        LocaleContextHolder.resetLocaleContext();
    }

    @Test
    void channelRead0PrefersMessageLanguageOverConnectionLanguage() {
        SandboxService sandboxService = mock(SandboxService.class);
        doAnswer(invocation -> {
            assertThat(LocaleContextHolder.getLocale()).isEqualTo(Locale.US);
            return null;
        }).when(sandboxService).heartbeat("u1", -1L);

        WebSocketHandler handler = new WebSocketHandler();
        ReflectionTestUtils.setField(handler, "chatService", mock(ChatService.class));
        ReflectionTestUtils.setField(handler, "notificationService", mock(NotificationService.class));
        ReflectionTestUtils.setField(handler, "sandboxService", sandboxService);

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(1L);
        loginInfo.setUserCode("u1");
        loginInfo.setUserName("tester");
        loginInfo.getParamMap().put("language", "zh-CN");

        EmbeddedChannel channel = new EmbeddedChannel(handler);
        channel.attr(Constant.ATT_USER_INFO).set(loginInfo);

        channel.writeInbound(new TextWebSocketFrame("{\"type\":\"HEARTBEAT\",\"language\":\"en-US\"}"));

        verify(sandboxService).heartbeat("u1", -1L);
        TextWebSocketFrame response = channel.readOutbound();
        assertThat(response.text()).contains("HEARTBEAT");
        response.release();
    }
}
