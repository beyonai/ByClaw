package com.iwhalecloud.byai.state.domain.ws.handler;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;

import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.state.domain.ws.constant.Constant;
import com.iwhalecloud.byai.state.domain.ws.service.ChatService;
import io.netty.channel.embedded.EmbeddedChannel;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class WebSocketHandlerDispatchTest {
    @Test
    void blockedStartupDoesNotOccupyIngressOrDelayHeartbeatAndStop() throws Exception {
        ChatService chat = mock(ChatService.class);
        CountDownLatch started = new CountDownLatch(1), release = new CountDownLatch(1);
        AtomicReference<Thread> worker = new AtomicReference<>();
        doAnswer(invocation -> {
            worker.set(Thread.currentThread());
            started.countDown();
            release.await(5, TimeUnit.SECONDS);
            return null;
        }).when(chat).llmChat(any(), any());
        WebSocketHandler handler = new WebSocketHandler();
        ReflectionTestUtils.setField(handler, "chatService", chat);
        ReflectionTestUtils.setField(handler, "sandboxService", mock(SandboxService.class));
        EmbeddedChannel channel = new EmbeddedChannel(handler);
        LoginInfo user = new LoginInfo();
        user.setUserId(1L);
        user.setUserCode("user");
        channel.attr(Constant.ATT_USER_INFO).set(user);
        ExecutorService ingress = Executors.newSingleThreadExecutor();
        try {
            Future<?> send = ingress.submit(() -> channel.writeInbound(new TextWebSocketFrame(
                "{\"type\":\"LLM_MESSAGE\",\"sessionId\":42,\"clientRequestId\":\"chat\"}")));
            assertThat(started.await(2, TimeUnit.SECONDS)).isTrue();
            send.get(500, TimeUnit.MILLISECONDS);
            assertThat(worker.get().isVirtual()).isTrue();
            channel.writeInbound(new TextWebSocketFrame("{\"type\":\"HEARTBEAT\"}"));
            TextWebSocketFrame heartbeat = channel.readOutbound();
            assertThat(heartbeat.text()).contains("HEARTBEAT");
            heartbeat.release();
            channel.writeInbound(new TextWebSocketFrame("{\"type\":\"STOP_CHAT\",\"sessionId\":42}"));
            verify(chat).stopChat(any(), any(), any());
        }
        finally {
            release.countDown();
            ingress.shutdownNow();
            channel.finishAndReleaseAll();
        }
    }
    @Test
    void queuedFramesKeepValidatedTenantUserLocaleAndRequestIdentityAfterSwitch() throws Exception {
        ChatService chat = mock(ChatService.class);
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1), done = new CountDownLatch(2);
        java.util.List<String> contexts = new java.util.concurrent.CopyOnWriteArrayList<>();
        java.util.List<Long> requests = new java.util.concurrent.CopyOnWriteArrayList<>();
        doAnswer(invocation -> {
            entered.countDown();
            release.await(3, TimeUnit.SECONDS);
            var tenant = com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContextHolder.get();
            var user = com.iwhalecloud.byai.common.login.auth.CurrentUserHolder.getLoginInfo();
            contexts.add(tenant.enterpriseId() + ":" + user.getUserCode() + ":"
                + org.springframework.context.i18n.LocaleContextHolder.getLocale().toLanguageTag());
            requests.add(com.iwhalecloud.byai.common.log.util.RequestContextUtil.getRequestId());
            done.countDown();
            return null;
        }).when(chat).llmChat(any(), any());
        var tenants = mock(com.iwhalecloud.byai.manager.domain.tenant.TenantContextService.class);
        when(tenants.validate("123")).thenReturn(new com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContext(1, 123, "MEMBER"));
        when(tenants.validate("456")).thenReturn(new com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContext(1, 456, "MEMBER"));
        WebSocketHandler handler = new WebSocketHandler();
        ReflectionTestUtils.setField(handler, "chatService", chat);
        ReflectionTestUtils.setField(handler, "tenantContextService", tenants);
        ReflectionTestUtils.setField(handler, "multiDeviceBroadcastService",
            mock(com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService.class));
        EmbeddedChannel channel = new EmbeddedChannel(handler);
        LoginInfo user = new LoginInfo(); user.setUserId(1L); user.setUserCode("original");
        channel.attr(Constant.ATT_USER_INFO).set(user);
        channel.attr(Constant.ATT_ENTERPRISE_ID).set("123");
        try {
            String frame = "{\"type\":\"LLM_MESSAGE\",\"enterpriseId\":\"123\",\"language\":\"en-US\",\"sessionId\":42}";
            channel.writeInbound(new TextWebSocketFrame(frame));
            assertThat(entered.await(2, TimeUnit.SECONDS)).isTrue();
            channel.writeInbound(new TextWebSocketFrame(frame));
            channel.writeInbound(new TextWebSocketFrame("{\"type\":\"SWITCH_TENANT\",\"enterpriseId\":\"456\"}"));
            ((TextWebSocketFrame) channel.readOutbound()).release();
            assertThat(channel.attr(Constant.ATT_ENTERPRISE_ID).get()).isEqualTo("456");
            user.setUserCode("changed");
            assertThat(contexts).isEmpty();
            release.countDown();
            assertThat(done.await(2, TimeUnit.SECONDS)).isTrue();
            assertThat(contexts).containsExactly("123:original:en-US", "123:original:en-US");
            assertThat(requests).hasSize(2).doesNotContainNull().doesNotHaveDuplicates();
            assertThat(com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContextHolder.get()).isNull();
            assertThat(com.iwhalecloud.byai.common.login.auth.CurrentUserHolder.getLoginInfo()).isNull();
            assertThat(com.iwhalecloud.byai.common.log.util.RequestContextUtil.getRequestId()).isNull();
        }
        finally { release.countDown(); channel.finishAndReleaseAll(); }
    }

    @Test
    void fullQueueReturnsAnErrorCorrelatedToRejectedFrame() throws Exception {
        ChatService chat = mock(ChatService.class);
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        doAnswer(invocation -> { entered.countDown(); release.await(3, TimeUnit.SECONDS); return null; })
            .when(chat).llmChat(any(), any());
        WebSocketChatDispatcher dispatcher = new WebSocketChatDispatcher(1, 1);
        WebSocketHandler handler = new WebSocketHandler(dispatcher);
        ReflectionTestUtils.setField(handler, "chatService", chat);
        EmbeddedChannel channel = new EmbeddedChannel(handler);
        LoginInfo user = new LoginInfo(); user.setUserId(1L); channel.attr(Constant.ATT_USER_INFO).set(user);
        try {
            channel.writeInbound(new TextWebSocketFrame("{\"type\":\"LLM_MESSAGE\",\"clientRequestId\":\"accepted\"}"));
            assertThat(entered.await(2, TimeUnit.SECONDS)).isTrue();
            channel.writeInbound(new TextWebSocketFrame("{\"type\":\"LLM_MESSAGE\",\"clientRequestId\":\"rejected\",\"sessionId\":42}"));
            TextWebSocketFrame response = channel.readOutbound();
            assertThat(response.text()).contains("ERROR", "rejected").doesNotContain("accepted");
            response.release();
            verify(chat, times(1)).llmChat(any(), any());
        }
        finally { release.countDown(); channel.finishAndReleaseAll(); dispatcher.shutdown(); }
    }

    @Test
    void slowNotificationLeaseUpdateDoesNotOccupyIngressOrDelayNewChatAndStop() throws Exception {
        ChatService chat = mock(ChatService.class);
        var notification = new com.iwhalecloud.byai.state.domain.notification.service.NotificationService();
        SandboxService sandbox = mock(SandboxService.class);
        CountDownLatch started = new CountDownLatch(1), release = new CountDownLatch(1), chatted = new CountDownLatch(1);
        doAnswer(invocation -> { started.countDown(); release.await(3, TimeUnit.SECONDS); return null; })
            .when(sandbox).heartbeat("user", -1L);
        ReflectionTestUtils.setField(notification, "sandboxService", sandbox);
        doAnswer(invocation -> { chatted.countDown(); return null; }).when(chat).llmChat(any(), any());
        WebSocketHandler handler = new WebSocketHandler();
        ReflectionTestUtils.setField(handler, "chatService", chat);
        ReflectionTestUtils.setField(handler, "notificationService", notification);
        EmbeddedChannel channel = new EmbeddedChannel(handler);
        LoginInfo user = new LoginInfo(); user.setUserId(1L); user.setUserCode("user");
        channel.attr(Constant.ATT_USER_INFO).set(user);
        ExecutorService ingress = Executors.newSingleThreadExecutor();
        try {
            Future<?> poll = ingress.submit(() -> channel.writeInbound(new TextWebSocketFrame("{\"type\":\"NOTIFICATION\"}")));
            assertThat(started.await(2, TimeUnit.SECONDS)).isTrue();
            poll.get(500, TimeUnit.MILLISECONDS);
            channel.writeInbound(new TextWebSocketFrame("{\"type\":\"LLM_MESSAGE\",\"sessionId\":42}"));
            assertThat(chatted.await(2, TimeUnit.SECONDS)).isTrue();
            channel.writeInbound(new TextWebSocketFrame("{\"type\":\"STOP_CHAT\",\"sessionId\":42}"));
            verify(chat).stopChat(any(), any(), any());
        }
        finally { release.countDown(); ingress.shutdownNow(); channel.finishAndReleaseAll(); }
    }

}
