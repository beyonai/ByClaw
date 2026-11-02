package com.iwhalecloud.byai.state.domain.ws.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import java.io.*;
import java.nio.charset.StandardCharsets;
import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.i18n.I18nTestSupport;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.domain.tenant.*;
import com.iwhalecloud.byai.state.application.service.chat.AssistantChatApplicationService;
import com.iwhalecloud.byai.state.application.service.message.MessageService;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatInfo;
import com.iwhalecloud.byai.state.domain.chat.service.AssistantChatService;
import com.iwhalecloud.byai.state.domain.chat.service.RunningOutputStreamRegistry;
import com.iwhalecloud.byai.state.domain.ws.constant.Constant;
import com.iwhalecloud.byai.state.domain.ws.model.ChatMessage;
import io.netty.channel.ChannelInboundHandlerAdapter;
import io.netty.channel.embedded.EmbeddedChannel;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.util.ReflectionTestUtils;

class ChatServiceAsyncContractTest extends I18nTestSupport {
    private final ChatService service = new ChatService();
    private final AssistantChatService assistant = mock(AssistantChatService.class);
    private final EmbeddedChannel channel = new EmbeddedChannel(new ChannelInboundHandlerAdapter());

    ChatServiceAsyncContractTest() {
        ReflectionTestUtils.setField(service, "assistantChatService", assistant);
        LoginInfo user = new LoginInfo(); user.setUserId(1L); user.setUserCode("original");
        channel.attr(Constant.ATT_USER_INFO).set(user);
        CurrentUserHolder.setLoginInfo(user);
    }

    @AfterEach
    void cleanup() {
        CurrentUserHolder.clearLoginInfo();
        TenantRequestContextHolder.clear();
        channel.finishAndReleaseAll();
    }

    @ParameterizedTest
    @NullSource
    @ValueSource(strings = {"123"})
    void outputUsesTheAdmittedTenantEvenWhenItStartsAfterAnotherTenantWasSelected(String admittedTenant) throws Exception {
        channel.attr(Constant.ATT_ENTERPRISE_ID).set("456");
        ChatMessage message = request(); message.setEnterpriseId(admittedTenant);
        doAnswer(invocation -> {
            ((OutputStream) invocation.getArgument(1)).write("{\"event\":\"answerDelta\"}".getBytes(StandardCharsets.UTF_8));
            return null;
        }).when(assistant).chat(any(), any(), any());
        service.llmChat(channel.pipeline().firstContext(), message);
        TextWebSocketFrame frame = channel.readOutbound();
        try { assertThat(JSON.parseObject(frame.text()).getString("enterpriseId")).isEqualTo(admittedTenant); }
        finally { frame.release(); }
    }

    @Test
    void llmIoFailureIsAWebSocketErrorWithTheOriginalRequestIdentity() throws Exception {
        doAnswer(invocation -> { throw new IOException("internal storage failure"); }).when(assistant).chat(any(), any(), any());
        service.llmChat(channel.pipeline().firstContext(), request());
        assertCorrelatedError();
    }

    @Test
    void replayIoFailureIsAWebSocketErrorWithTheOriginalRequestIdentity() {
        MessageService messages = mock(MessageService.class);
        ReflectionTestUtils.setField(service, "messageService", messages);
        when(messages.getSseBufferedReader(any())).thenReturn(new BufferedReader(new Reader() {
            @Override public int read(char[] buffer, int offset, int length) throws IOException { throw new IOException("internal storage failure"); }
            @Override public void close() { }
        }));
        service.sseStream(channel.pipeline().firstContext(), request());
        assertCorrelatedError();
    }

    @Test
    void stopFailureIsCorrelatedAndDoesNotRunTheLocalCancellationCallback() {
        var app = mock(AssistantChatApplicationService.class);
        doThrow(new IllegalStateException("internal stop failure")).when(app).stopChat(any());
        ReflectionTestUtils.setField(service, "assistantChatApplicationService", app);
        var running = mock(RunningOutputStreamRegistry.class);
        when(running.getRunning(42L)).thenReturn(new RunningChatInfo());
        ReflectionTestUtils.setField(service, "runningOutputStreamRegistry", running);
        java.util.concurrent.atomic.AtomicBoolean cancelled = new java.util.concurrent.atomic.AtomicBoolean();
        service.stopChat(channel.pipeline().firstContext(), request(), () -> cancelled.set(true));
        assertThat(cancelled).isFalse();
        assertCorrelatedError();
    }

    @Test
    void cancelledStartupCannotWriteLateStreamOrErrorAfterStopAcknowledgment() throws Exception {
        var cancelled = new java.util.concurrent.atomic.AtomicBoolean();
        try (var output = new com.iwhalecloud.byai.state.domain.ws.manager.NettyArrayOutputStream(
            channel.pipeline().firstContext(), "request", "CHAT_STREAM", "request", "123")) {
            com.iwhalecloud.byai.state.domain.chat.service.ChatRequestCancellation.run(cancelled, session -> { }, () -> {
                cancelled.set(true);
                output.write("{\"event\":\"error\"}".getBytes(StandardCharsets.UTF_8), 0, 17);
                WebSocketErrorResponses.send(channel.pipeline().firstContext(), request(), "late error");
            });
            assertThat((Object) channel.readOutbound()).isNull();
            assertThat(output.size()).isZero();
        }
    }

    private ChatMessage request() {
        ChatMessage message = new ChatMessage(); message.setClientRequestId("original-request"); message.setSessionId(42L);
        return message;
    }

    private void assertCorrelatedError() {
        Object outbound = channel.readOutbound();
        assertThat(outbound).isInstanceOf(TextWebSocketFrame.class);
        TextWebSocketFrame frame = (TextWebSocketFrame) outbound;
        try { assertThat(frame.text()).contains("ERROR", "original-request", "42").doesNotContain("internal"); }
        finally { frame.release(); }
    }
}
