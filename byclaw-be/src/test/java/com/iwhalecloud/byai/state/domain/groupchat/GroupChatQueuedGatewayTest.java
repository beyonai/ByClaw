package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.Mockito;
import org.springframework.transaction.PlatformTransactionManager;

import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxUserContextRunner;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTurn;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatExecutionMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTurnMapper;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.service.ChatProcessContext;
import com.iwhalecloud.byai.state.domain.chat.service.ScriptService;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatMemberUidCodec;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatContextTokenService;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatDispatchPromptBuilder;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatGatewayExecutor;
import com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

class GroupChatQueuedGatewayTest {
    private final ByaiMessageMapper messages = mock(ByaiMessageMapper.class);
    private final ByaiGroupChatTurnMapper turns = mock(ByaiGroupChatTurnMapper.class);
    private final ByaiGroupChatTaskMapper tasks = mock(ByaiGroupChatTaskMapper.class);
    private final ScriptService script = mock(ScriptService.class);
    private final SessionService sessions = mock(SessionService.class);
    private final GroupChatContextTokenService tokens = mock(GroupChatContextTokenService.class);
    private GroupChatGatewayExecutor executor;
    private ByaiGroupChatTurn turn;
    private ByaiSession session;

    @BeforeEach
    void setUp() {
        UserService users = mock(UserService.class);
        Users user = new Users();
        user.setUserCode("user30");
        user.setUserName("用户三十");
        when(users.findById(30L)).thenReturn(user);
        SsResourceService resources = mock(SsResourceService.class);
        when(resources.findById(40L)).thenReturn(new SsResource());
        SequenceService sequences = mock(SequenceService.class);
        when(sequences.nextVal()).thenReturn(72L);
        SandboxUserContextRunner runner = mock(SandboxUserContextRunner.class);
        doAnswer(call -> { call.getArgument(1, Runnable.class).run(); return null; })
            .when(runner).runAsUser(eq("user30"), any());
        SessionMemberService members = mock(SessionMemberService.class);
        when(members.findSessionMembers(10L, null, null)).thenReturn(List.of());
        when(members.findSessionMember(anyLong(), anyString(), anyLong())).thenReturn(new ByaiSessionMember());
        executor = new GroupChatGatewayExecutor(script, messages, users, resources, tokens,
            new GroupChatDispatchPromptBuilder(), members, new GroupChatMemberUidCodec(),
            mock(ByaiGroupChatExecutionMapper.class), sequences, runner, turns, sessions);
        executor.configureTurnTransactions(mock(PlatformTransactionManager.class), tasks);
        turn = new ByaiGroupChatTurn();
        turn.setExecutionId(52L);
        turn.setAnchorExecutionId(50L);
        turn.setGroupSessionId(10L);
        turn.setCandidateSessionId(60L);
        turn.setGatewaySessionId("60");
        turn.setInitiatorUserId(30L);
        turn.setTargetAgentId(40L);
        turn.setInputMessageId(71L);
        turn.setTriggerMessageId(69L);
        turn.setPublicBoundaryMessageId(68L);
        turn.setSourceMessageId(68L);
        turn.setRootMessageId(20L);
        turn.setInputContent("原始需求：分析新闻\n本次发送者：B（41）\n本次消息：已整理资料，请分析。");
        turn.setInputMetadata("{\"senderType\":\"AGENT\",\"senderId\":41,\"resourceList\":[{\"resourceType\":\"DIG_EMPLOYEE\",\"resourceId\":\"40\"}]}");
        turn.setStatus("RUNNING");
        turn.setPhase("NORMAL");
        session = new ByaiSession();
        session.setSessionId(60L);
        session.setCreatorId(30L);
        session.setObjectId(40L);
        session.setProjectId(11L);
        when(sessions.findById(60L)).thenReturn(session);
        when(turns.bindRuntime(eq(52L), any())).thenReturn(1);
        when(turns.selectForUpdateById(52L)).thenReturn(turn);
    }

    @Test
    void returnTurnPersistsAndSendsCurrentInputWithDistinctIdentityInExistingSession() throws Exception {
        executor.executeTurn(turn);
        ArgumentCaptor<ByaiMessage> persisted = ArgumentCaptor.forClass(ByaiMessage.class);
        ArgumentCaptor<AssistantChatDto> request = ArgumentCaptor.forClass(AssistantChatDto.class);
        ArgumentCaptor<ByaiMessageHotDtoDto> existing = ArgumentCaptor.forClass(ByaiMessageHotDtoDto.class);
        InOrder order = Mockito.inOrder(messages, turns, script);
        order.verify(turns).selectForUpdateById(52L);
        order.verify(messages).selectByMessageId(71L);
        order.verify(messages).insert(persisted.capture());
        order.verify(turns).bindRuntime(52L, ScriptService.getTraceId(71L, 72L));
        order.verify(script).startExistingMessageTurn(request.capture(), existing.capture());
        assertThat(request.getValue().getSessionId()).isEqualTo(60L);
        assertThat(request.getValue().getChatContent()).isEqualTo(turn.getInputContent());
        assertThat(request.getValue().getClientRequestId()).isEqualTo("71_72");
        assertThat(request.getValue().getResourceList()).hasSize(1);
        assertThat(persisted.getValue().getMetadata()).isEqualTo(turn.getInputMetadata());
        assertThat(persisted.getValue().getCreatorId()).isEqualTo(30L);
        verify(messages, never()).selectBySessionId(any());
    }

    @Test
    void assessmentUsesIsolatedRuntimeAndSuppressesUserTransport() throws Exception {
        turn.setPhase("ASSESSMENT");
        turn.setGatewaySessionId("600");
        session.setSessionId(600L);
        when(sessions.findById(600L)).thenReturn(session);
        executor.executeTurn(turn);
        ArgumentCaptor<AssistantChatDto> request = ArgumentCaptor.forClass(AssistantChatDto.class);
        verify(script).startExistingMessageTurn(request.capture(), any(), eq(true));
        assertThat(request.getValue().getSessionId()).isEqualTo(600L);
        assertThat(turn.getCandidateSessionId()).isEqualTo(60L);
        ChatProcessContext ctx = context(600L);
        when(turns.selectByTrace(ctx.traceId)).thenReturn(turn);
        Map<String, Object> params = new HashMap<>();
        String content = (String) executor.decorate(ctx, turn.getInputContent(), params);
        assertThat(content).contains("/by/.sessions/600/.byclaw/", "仅分类，禁止执行业务");
        verify(tokens).issue(10L, 600L, 30L, 40L, 68L);
        assertThat(((Map<?, ?>) params.get("groupChat")).get("beforeMessageId")).isEqualTo("68");
    }

    @Test
    void eachContinuedTurnUsesItsOwnDispatchAndPublicBoundary() {
        turn.setTraceId(ScriptService.getTraceId(71L, 72L));
        ChatProcessContext ctx = context(60L);
        when(turns.selectByTrace(ctx.traceId)).thenReturn(turn);
        Map<String, Object> params = new HashMap<>();
        String content = (String) executor.decorate(ctx, turn.getInputContent(), params);
        assertThat(content).contains("\"dispatchId\":\"52\"");
        verify(tokens).issue(10L, 60L, 30L, 40L, 68L);
        turn.setPhase("CHAT_CONTINUATION");
        assertThat((String) executor.decorate(ctx, turn.getInputContent(), params))
            .contains("不要重新执行原始任务").doesNotContain("group-chat-disposition.json");
    }

    @Test
    void mismatchedSessionTraceOrPersistedInputCannotBeSent() throws Exception {
        turn.setTraceId(ScriptService.getTraceId(71L, 72L));
        ChatProcessContext ctx = context(99L);
        when(turns.selectByTrace(ctx.traceId)).thenReturn(turn);
        assertThatThrownBy(() -> executor.decorate(ctx, "bad", new HashMap<>()))
            .isInstanceOf(IllegalArgumentException.class);
        turn.setTraceId(null);
        ByaiMessage wrong = new ByaiMessage();
        wrong.setSessionId(99L);
        when(messages.selectByMessageId(71L)).thenReturn(wrong);
        assertThatThrownBy(() -> executor.executeTurn(turn)).isInstanceOf(IllegalArgumentException.class);
        verify(script, never()).startExistingMessageTurn(any(), any());
    }

    @Test
    void boundRetryDoesNotStartAgainAndNewActiveTaskStopsUnboundPreparation() throws Exception {
        turn.setTraceId("possibly-sent");
        executor.executeTurn(turn);
        verify(script, never()).startExistingMessageTurn(any(), any());
        verify(messages, never()).insert(any(ByaiMessage.class));
        turn.setTraceId(null);
        ByaiGroupChatTask active = new ByaiGroupChatTask();
        active.setStatus("ACTIVE");
        active.setTurnStatus("WAITING_USER");
        when(tasks.selectById(60L)).thenReturn(active);
        assertThatThrownBy(() -> executor.executeTurn(turn)).isInstanceOf(IllegalArgumentException.class);
        verify(turns, never()).bindRuntime(anyLong(), anyString());
    }

    private ChatProcessContext context(Long sessionId) {
        ChatProcessContext ctx = new ChatProcessContext(null, new AssistantChatDto());
        ctx.sessionId = sessionId;
        ctx.userId = 30L;
        ctx.assistantChatDto.setAgentId(40L);
        ctx.traceId = turn.getTraceId();
        return ctx;
    }
}
