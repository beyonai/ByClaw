package com.iwhalecloud.byai.state.domain.ws.handler;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.doThrow;

import java.util.Locale;

import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantContextService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContext;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContextHolder;
import com.iwhalecloud.byai.state.domain.notification.service.NotificationService;
import com.iwhalecloud.byai.state.domain.ws.constant.Constant;
import com.iwhalecloud.byai.state.domain.ws.service.ChatService;
import com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService;
import com.iwhalecloud.byai.state.domain.ws.service.TaskPlanWebSocketService;
import io.netty.channel.embedded.EmbeddedChannel;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

class WebSocketHandlerI18nTest {
    @Test
    void tenantTaskPlanLookupDoesNotFailTheActiveChat() {
        TenantContextService tenantContextService = mock(TenantContextService.class);
        org.mockito.Mockito.when(tenantContextService.validate("123"))
            .thenReturn(new TenantRequestContext(1L, 123L, "MEMBER"));
        TaskPlanWebSocketService taskPlanService = mock(TaskPlanWebSocketService.class);
        WebSocketHandler handler = new WebSocketHandler();
        ReflectionTestUtils.setField(handler, "tenantContextService", tenantContextService);
        ReflectionTestUtils.setField(handler, "taskPlanWebSocketService", taskPlanService);

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(1L);
        loginInfo.setUserCode("u1");
        loginInfo.setUserName("tester");
        EmbeddedChannel channel = new EmbeddedChannel(handler);
        channel.attr(Constant.ATT_USER_INFO).set(loginInfo);
        channel.attr(Constant.ATT_ENTERPRISE_ID).set("123");
        try {
            channel.writeInbound(new TextWebSocketFrame(
                "{\"type\":\"TASK_PLAN_GET\",\"enterpriseId\":\"123\",\"clientRequestId\":\"chat-1\",\"sessionId\":\"42\"}"));
            TextWebSocketFrame response = channel.readOutbound();
            assertThat(response).isNull();
            org.mockito.Mockito.verifyNoInteractions(taskPlanService);
        }
        finally {
            channel.finishAndReleaseAll();
        }
    }


    @AfterEach
    void tearDown() {
        LocaleContextHolder.resetLocaleContext();
        TenantRequestContextHolder.clear();
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

    @Test
    void heartbeatUpdatesTheSelectedScopedChildWithoutAddingANewMessageType() {
        WebSocketHandler handler = new WebSocketHandler();
        ReflectionTestUtils.setField(handler, "chatService", mock(ChatService.class));
        ReflectionTestUtils.setField(handler, "notificationService", mock(NotificationService.class));
        ReflectionTestUtils.setField(handler, "sandboxService", mock(SandboxService.class));

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(1L);
        loginInfo.setUserCode("u1");
        loginInfo.setUserName("tester");
        EmbeddedChannel channel = new EmbeddedChannel(handler);
        channel.attr(Constant.ATT_USER_INFO).set(loginInfo);

        channel.writeInbound(new TextWebSocketFrame(
            "{\"type\":\"HEARTBEAT\",\"scopedSessionId\":\"201\"}"));
        assertThat(channel.attr(Constant.ATT_SCOPED_SESSION_ID).get()).isEqualTo("201");
        ((TextWebSocketFrame) channel.readOutbound()).release();

        channel.writeInbound(new TextWebSocketFrame(
            "{\"type\":\"HEARTBEAT\",\"scopedSessionId\":\"\"}"));
        assertThat(channel.attr(Constant.ATT_SCOPED_SESSION_ID).get()).isNull();
        ((TextWebSocketFrame) channel.readOutbound()).release();
    }

    @Test
    void switchTenantUsesPayloadWithoutReconnectingAndRoutesChatWithTenantContext() {
        TenantContextService tenantContextService = mock(TenantContextService.class);
        TenantRequestContext tenant = new TenantRequestContext(1L, 123L, "MEMBER");
        org.mockito.Mockito.when(tenantContextService.validate("123")).thenReturn(tenant);
        MultiDeviceBroadcastService broadcastService = mock(MultiDeviceBroadcastService.class);
        ChatService chatService = mock(ChatService.class);
        doAnswer(invocation -> {
            assertThat(TenantRequestContextHolder.get()).isEqualTo(tenant);
            return null;
        }).when(chatService).llmChat(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
        WebSocketHandler handler = new WebSocketHandler();
        ReflectionTestUtils.setField(handler, "tenantContextService", tenantContextService);
        ReflectionTestUtils.setField(handler, "multiDeviceBroadcastService", broadcastService);
        ReflectionTestUtils.setField(handler, "chatService", chatService);
        ReflectionTestUtils.setField(handler, "sandboxService", mock(SandboxService.class));

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(1L);
        loginInfo.setUserCode("u1");
        loginInfo.setUserName("tester");
        EmbeddedChannel channel = new EmbeddedChannel(handler);
        channel.attr(Constant.ATT_USER_INFO).set(loginInfo);
        channel.attr(Constant.ATT_SCOPED_SESSION_ID).set("old-session");
        try {
            channel.writeInbound(new TextWebSocketFrame(
                "{\"type\":\"SWITCH_TENANT\",\"enterpriseId\":\"123\",\"clientRequestId\":\"switch-1\"}"));
            assertThat(channel.attr(Constant.ATT_ENTERPRISE_ID).get()).isEqualTo("123");
            assertThat(channel.attr(Constant.ATT_SCOPED_SESSION_ID).get()).isNull();
            verify(tenantContextService).validate("123");
            verify(broadcastService).clearChannelSubscription(channel);
            TextWebSocketFrame ack = channel.readOutbound();
            assertThat(ack.text()).contains("SWITCH_TENANT_ACK", "switch-1", "123");
            ack.release();

            channel.writeInbound(new TextWebSocketFrame(
                "{\"type\":\"LLM_MESSAGE\",\"enterpriseId\":\"123\",\"clientRequestId\":\"chat-1\"}"));
            verify(chatService).llmChat(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
            assertThat(TenantRequestContextHolder.get()).isNull();
        }
        finally {
            channel.finishAndReleaseAll();
        }
    }

    @Test
    void failedMembershipCheckKeepsThePreviousTenantSelection() {
        TenantContextService tenantContextService = mock(TenantContextService.class);
        doThrow(new ResponseStatusException(HttpStatus.FORBIDDEN))
            .when(tenantContextService).validate("456");
        WebSocketHandler handler = new WebSocketHandler();
        ReflectionTestUtils.setField(handler, "tenantContextService", tenantContextService);
        ReflectionTestUtils.setField(handler, "multiDeviceBroadcastService", mock(MultiDeviceBroadcastService.class));

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(1L);
        loginInfo.setUserName("tester");
        EmbeddedChannel channel = new EmbeddedChannel(handler);
        channel.attr(Constant.ATT_USER_INFO).set(loginInfo);
        channel.attr(Constant.ATT_ENTERPRISE_ID).set("123");
        try {
            channel.writeInbound(new TextWebSocketFrame(
                "{\"type\":\"SWITCH_TENANT\",\"enterpriseId\":\"456\",\"clientRequestId\":\"switch-2\"}"));
            assertThat(channel.attr(Constant.ATT_ENTERPRISE_ID).get()).isEqualTo("123");
            TextWebSocketFrame error = channel.readOutbound();
            assertThat(error.text()).contains("ERROR", "switch-2");
            error.release();
        }
        finally {
            channel.finishAndReleaseAll();
        }
    }

    @Test
    void tenantChatFailureUsesCorrelatedWebSocketErrorFrame() {
        TenantContextService tenantContextService = mock(TenantContextService.class);
        org.mockito.Mockito.when(tenantContextService.validate("123"))
            .thenReturn(new TenantRequestContext(1L, 123L, "MEMBER"));
        ChatService chatService = mock(ChatService.class);
        doThrow(new IllegalStateException("sandbox starting"))
            .when(chatService).llmChat(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
        WebSocketHandler handler = new WebSocketHandler();
        ReflectionTestUtils.setField(handler, "tenantContextService", tenantContextService);
        ReflectionTestUtils.setField(handler, "chatService", chatService);

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(1L);
        loginInfo.setUserName("tester");
        EmbeddedChannel channel = new EmbeddedChannel(handler);
        channel.attr(Constant.ATT_USER_INFO).set(loginInfo);
        channel.attr(Constant.ATT_ENTERPRISE_ID).set("123");
        try {
            channel.writeInbound(new TextWebSocketFrame(
                "{\"type\":\"LLM_MESSAGE\",\"enterpriseId\":\"123\",\"clientRequestId\":\"chat-1\"}"));
            TextWebSocketFrame error = channel.readOutbound();
            assertThat(error.text()).contains("ERROR", "chat-1", "123");
            error.release();
            assertThat(TenantRequestContextHolder.get()).isNull();
        }
        finally {
            channel.finishAndReleaseAll();
        }
    }
}
