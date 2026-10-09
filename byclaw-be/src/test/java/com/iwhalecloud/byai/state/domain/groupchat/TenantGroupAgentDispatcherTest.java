package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.MessageSource;
import org.springframework.context.support.StaticMessageSource;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxUserContextRunner;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.CommandResult;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.GroupDispatch;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.GroupTaskUpdate;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContext;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContextHolder;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.state.domain.chat.service.AssistantChatService;
import com.iwhalecloud.byai.state.domain.groupchat.application.TenantGroupAgentDispatcher;
import com.iwhalecloud.byai.state.infrastructure.utils.CompletionsUtils;

class TenantGroupAgentDispatcherTest {
    private final TenantNodeClient node = mock(TenantNodeClient.class);
    private final UserService users = mock(UserService.class);
    private final LoginApplicationService login = mock(LoginApplicationService.class);
    private final AssistantChatService chat = mock(AssistantChatService.class);
    private final TenantRequestContext tenant = new TenantRequestContext(20L, 10L, "MEMBER");
    private final TenantGroupAgentDispatcher dispatcher = new TenantGroupAgentDispatcher(users,
        new SandboxUserContextRunner(login), chat, node);
    private MessageSource originalMessageSource;

    @BeforeEach
    void setUp() {
        originalMessageSource = (MessageSource) ReflectionTestUtils.getField(I18nUtil.class, "messageSource");
        StaticMessageSource messages = new StaticMessageSource();
        messages.setUseCodeAsDefaultMessage(true);
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messages);
        Users user = new Users();
        user.setUserId(20L);
        user.setUserCode("user-20");
        when(users.findById(20L)).thenReturn(user);
        when(login.getLoginInfo("user-20")).thenReturn(new LoginInfo());
        when(node.command(eq(tenant), eq("POST"), eq("/internal/v1/group-chats/30/tasks/50/claim"),
            eq("30"), eq("CLAIM_TASK"), any()))
            .thenReturn(new CommandResult("30", "claim-50", "CLAIM_TASK", null, List.of(), true));
    }

    @AfterEach
    void tearDown() throws InterruptedException {
        awaitDispatch();
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", originalMessageSource);
        CurrentUserHolder.clearLoginInfo();
        TenantRequestContextHolder.clear();
    }

    @Test
    void streamingEventsDoNotPreventTenantTaskCompletionOrRetainResponseBytes() throws Exception {
        AtomicReference<OutputStream> response = new AtomicReference<>();
        doAnswer(call -> {
            OutputStream stream = call.getArgument(1);
            response.set(stream);
            CompletionsUtils.responseWrite(stream, "initialization", "{\"messageId\":\"61\"}");
            CompletionsUtils.responseWrite(stream, "appStreamResponse", "{\"content\":\"hello\"}", 50L);
            CompletionsUtils.responseWrite(stream, "[DONE]");
            byte[] chunk = new byte[8192];
            for (int i = 0; i < 128; i++) {
                stream.write(chunk);
            }
            stream.write(chunk, 1, 100);
            stream.write(65);
            stream.flush();
            stream.close();
            return null;
        }).when(chat).chat(any(), any(), isNull());
        when(node.request(eq(tenant), eq("GET"), eq("/internal/v1/group-chat/tasks/50"), isNull(), any()))
            .thenReturn(Map.of("status", "ACTIVE", "turnStatus", "WAITING_USER"));

        dispatcher.dispatch(tenant, 30L, "40", "hello", List.of(new GroupDispatch("50", "90")));
        awaitDispatch();

        verify(node).request(eq(tenant), eq("GET"), eq("/internal/v1/group-chat/tasks/50"), isNull(), any());
        verify(node, never()).command(eq(tenant), eq("PATCH"), any(), any(), any(), any(), any());
        assertThat(response.get()).isInstanceOf(ByteArrayOutputStream.class);
        assertThat(((ByteArrayOutputStream) response.get()).size()).isZero();
    }

    @Test
    void chatFailureAfterWritingAnErrorEventStillMarksTheTenantTaskFailed() throws Exception {
        AtomicBoolean errorEventWritten = new AtomicBoolean();
        doAnswer(call -> {
            CompletionsUtils.responseWrite(call.getArgument(1), "error", "{\"message\":\"unavailable\"}", 50L);
            errorEventWritten.set(true);
            throw new IOException("gateway unavailable");
        }).when(chat).chat(any(), any(), isNull());

        dispatcher.dispatch(tenant, 30L, "40", "hello", List.of(new GroupDispatch("50", "90")));
        awaitDispatch();

        assertThat(errorEventWritten).isTrue();
        verify(node).command(tenant, "PATCH", "/internal/v1/group-chats/30/tasks/50", "30", "UPDATE_TASK",
            new GroupTaskUpdate("50", "ACTIVE", "FAILED"), "group-task-failed-50");
        verify(node, never()).request(eq(tenant), eq("GET"), eq("/internal/v1/group-chat/tasks/50"), isNull(), any());
    }

    private void awaitDispatch() throws InterruptedException {
        dispatcher.close();
        ExecutorService workers = (ExecutorService) ReflectionTestUtils.getField(dispatcher, "workers");
        assertThat(workers.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
    }
}
