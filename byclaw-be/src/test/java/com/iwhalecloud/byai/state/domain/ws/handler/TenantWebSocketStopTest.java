package com.iwhalecloud.byai.state.domain.ws.handler;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.domain.tenant.*;
import com.iwhalecloud.byai.state.application.service.chat.AssistantChatApplicationService;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatInfo;
import com.iwhalecloud.byai.state.domain.chat.dto.StopChatDto;
import com.iwhalecloud.byai.state.domain.chat.service.RunningChatSnapshotService;
import com.iwhalecloud.byai.state.domain.chat.service.RunningOutputStreamRegistry;
import com.iwhalecloud.byai.state.domain.ws.constant.Constant;
import com.iwhalecloud.byai.state.domain.ws.service.ChatService;
import io.netty.channel.embedded.EmbeddedChannel;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.aop.aspectj.annotation.AspectJProxyFactory;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;

class TenantWebSocketStopTest {
    private final TenantNodeClient node = mock(TenantNodeClient.class);
    private final RunningOutputStreamRegistry running = mock(RunningOutputStreamRegistry.class);
    private final AssistantChatApplicationService application = mock(AssistantChatApplicationService.class);
    private final TenantRequestContext tenant = new TenantRequestContext(1L, 123L, "MEMBER");

    private EmbeddedChannel channel() {
        ChatService service = new ChatService();
        ReflectionTestUtils.setField(service, "assistantChatApplicationService", application);
        ReflectionTestUtils.setField(service, "runningOutputStreamRegistry", running);
        AspectJProxyFactory proxy = new AspectJProxyFactory(service);
        proxy.addAspect(new TenantChatRuntimeRoutingAspect(node, running,
            mock(RunningChatSnapshotService.class), application));
        TenantContextService tenants = mock(TenantContextService.class);
        when(tenants.validate("123")).thenReturn(tenant);
        WebSocketHandler handler = new WebSocketHandler();
        ReflectionTestUtils.setField(handler, "tenantContextService", tenants);
        ReflectionTestUtils.setField(handler, "chatService", proxy.getProxy());
        ReflectionTestUtils.setField(handler, "tenantNodeClient", node);
        LoginInfo user = new LoginInfo();
        user.setUserId(1L);
        user.setUserCode("tester");
        user.setUserName("tester");
        EmbeddedChannel channel = new EmbeddedChannel(handler);
        channel.attr(Constant.ATT_USER_INFO).set(user);
        channel.attr(Constant.ATT_ENTERPRISE_ID).set("123");
        when(running.getRunning(42L)).thenReturn(new RunningChatInfo());
        return channel;
    }

    @AfterEach
    void clearContext() {
        CurrentUserHolder.clearLoginInfo();
        TenantRequestContextHolder.clear();
    }

    @Test
    void tenantChildSubscriptionAuthorizesExactIdAndCanBeCleared() {
        EmbeddedChannel channel = channel();
        try {
            channel.writeInbound(new TextWebSocketFrame(
                "{\"type\":\"HEARTBEAT\",\"enterpriseId\":\"123\",\"scopedSessionId\":\"8011237409000004505\"}"));
            TextWebSocketFrame response = channel.readOutbound();
            assertThat(response.text()).contains("HEARTBEAT");
            response.release();
            assertThat(channel.attr(Constant.ATT_SCOPED_SESSION_ID).get()).isEqualTo("8011237409000004505");
            verify(node).request(eq(tenant), eq("GET"), eq("/internal/v1/sessions/8011237409000004505"), any(), any());
            channel.writeInbound(new TextWebSocketFrame(
                "{\"type\":\"HEARTBEAT\",\"enterpriseId\":\"123\",\"scopedSessionId\":\"\"}"));
            ((TextWebSocketFrame) channel.readOutbound()).release();
            assertThat(channel.attr(Constant.ATT_SCOPED_SESSION_ID).get()).isNull();
        } finally { channel.finishAndReleaseAll(); }
    }

    @Test
    void inaccessibleTenantChildCannotReplaceExistingSubscription() {
        EmbeddedChannel channel = channel();
        try {
            channel.attr(Constant.ATT_SCOPED_SESSION_ID).set("42");
            when(node.request(eq(tenant), eq("GET"), eq("/internal/v1/sessions/99"), any(), any()))
                .thenThrow(new ResponseStatusException(HttpStatus.FORBIDDEN));
            channel.writeInbound(new TextWebSocketFrame(
                "{\"type\":\"HEARTBEAT\",\"enterpriseId\":\"123\",\"scopedSessionId\":\"99\"}"));
            TextWebSocketFrame response = channel.readOutbound();
            assertThat(response.text()).contains("ERROR");
            response.release();
            verify(node).request(eq(tenant), eq("GET"), eq("/internal/v1/sessions/99"), any(), any());
            assertThat(channel.attr(Constant.ATT_SCOPED_SESSION_ID).get()).isEqualTo("42");
        } finally { channel.finishAndReleaseAll(); }
    }

    @Test
    void authorizedTenantStopReachesCancellationAndAcknowledgesItsRequest() {
        EmbeddedChannel channel = channel();
        try {
            channel.writeInbound(new TextWebSocketFrame(
                "{\"type\":\"STOP_CHAT\",\"enterpriseId\":\"123\",\"sessionId\":\"42\",\"clientRequestId\":\"stop-1\"}"));
            TextWebSocketFrame frame = channel.readOutbound();
            try {
                var ack = JSON.parseObject(frame.text());
                assertThat(ack.getString("type")).isEqualTo("STOP_CHAT_ACK");
                assertThat(ack.getString("clientRequestId")).isEqualTo("stop-1");
                assertThat(ack.getString("enterpriseId")).isEqualTo("123");
                ArgumentCaptor<StopChatDto> stop = ArgumentCaptor.forClass(StopChatDto.class);
                verify(application).stopChat(stop.capture());
                assertThat(stop.getValue().getSessionId()).isEqualTo(42L);
                var order = inOrder(node, running, application);
                order.verify(node).request(eq(tenant), eq("GET"), eq("/internal/v1/sessions/42"), any(), any());
                order.verify(running).getRunning(42L);
                order.verify(application).stopChat(any());
                assertThat(TenantRequestContextHolder.get()).isNull();
            } finally {
                frame.release();
            }
        } finally {
            channel.finishAndReleaseAll();
        }
    }

    @Test
    void inaccessibleTenantSessionCannotBeStopped() {
        EmbeddedChannel channel = channel();
        try {
            when(node.request(eq(tenant), eq("GET"), eq("/internal/v1/sessions/42"), any(), any()))
                .thenThrow(new ResponseStatusException(HttpStatus.FORBIDDEN));
            channel.writeInbound(new TextWebSocketFrame(
                "{\"type\":\"STOP_CHAT\",\"enterpriseId\":\"123\",\"sessionId\":\"42\",\"clientRequestId\":\"stop-2\"}"));
            TextWebSocketFrame frame = channel.readOutbound();
            assertThat(frame.text()).contains("ERROR", "stop-2", "123");
            frame.release();
            verify(node).request(eq(tenant), eq("GET"), eq("/internal/v1/sessions/42"), any(), any());
            verifyNoInteractions(application, running);
        } finally {
            channel.finishAndReleaseAll();
        }
    }

    @Test
    void messageFromAnotherSessionCannotAuthorizeAStop() {
        EmbeddedChannel channel = channel();
        try {
            var foreign = new TenantNodeModels.MessageView();
            foreign.setMessageId("99");
            foreign.setSessionId("43");
            when(node.request(eq(tenant), eq("POST"), eq("/internal/v1/assiman/getMessageByIds"), any(), any()))
                .thenReturn(List.of(foreign));
            channel.writeInbound(new TextWebSocketFrame(
                "{\"type\":\"STOP_CHAT\",\"enterpriseId\":\"123\",\"sessionId\":\"42\",\"messageId\":\"99\",\"clientRequestId\":\"stop-3\"}"));
            TextWebSocketFrame frame = channel.readOutbound();
            assertThat(frame.text()).contains("ERROR", "stop-3");
            frame.release();
            verify(node).request(eq(tenant), eq("POST"), eq("/internal/v1/assiman/getMessageByIds"), any(), any());
            verifyNoInteractions(application);
        } finally {
            channel.finishAndReleaseAll();
        }
    }
}
