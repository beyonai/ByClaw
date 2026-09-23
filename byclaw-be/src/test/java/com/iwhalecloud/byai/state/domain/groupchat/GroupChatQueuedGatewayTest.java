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

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
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
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatSessionContextFileService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatTaskAuthorizationService;
import com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

class GroupChatQueuedGatewayTest {
    private static final String CURRENT_MESSAGE = "已整理资料，请分析。";

    private final ByaiMessageMapper messages = mock(ByaiMessageMapper.class);
    private final ByaiGroupChatTurnMapper turns = mock(ByaiGroupChatTurnMapper.class);
    private final ByaiGroupChatTaskMapper tasks = mock(ByaiGroupChatTaskMapper.class);
    private final ScriptService script = mock(ScriptService.class);
    private final SessionService sessions = mock(SessionService.class);
    private final GroupChatContextTokenService tokens = mock(GroupChatContextTokenService.class);
    private final GroupChatSessionContextFileService historyFiles = mock(GroupChatSessionContextFileService.class);
    private final GroupChatTaskAuthorizationService taskAuthorization = mock(GroupChatTaskAuthorizationService.class);
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
        executor.configureContextFiles(historyFiles, taskAuthorization);
        when(historyFiles.prepareGroupHistory(any(), any(), any(), any()))
            .thenReturn(new GroupChatSessionContextFileService.ContextFile(
                "GROUP_PUBLIC", "/by/.sessions/60/.byclaw/context/turn/group-history.json", "20"));
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
        JSONObject input = new JSONObject(true);
        input.put("原始用户需求", "分析新闻");
        input.put("本次发送者类型", "AGENT");
        input.put("本次发送者ID", 41L);
        input.put("本次发送者名称", "B");
        input.put("本次接收者ID", 40L);
        input.put("本次接收者名称", "A");
        input.put("本次消息", CURRENT_MESSAGE);
        turn.setInputContent(input.toJSONString());
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
        assertThat(request.getValue().getChatContent()).isEqualTo(CURRENT_MESSAGE);
        assertThat(persisted.getValue().getMessageContent()).isEqualTo(CURRENT_MESSAGE);
        assertThat(existing.getValue().getMessageContent()).isEqualTo(CURRENT_MESSAGE);
        ChatProcessContext ctx = context(60L);
        when(turns.selectByTrace(ctx.traceId)).thenReturn(turn);
        String outbound = (String) executor.decorate(ctx, request.getValue().getChatContent(), new HashMap<>());
        assertThat(outbound).startsWith(CURRENT_MESSAGE + "\n\n").contains(turn.getInputContent(), "[任务交付提醒]");
        assertThat(request.getValue().getChatContent()).isEqualTo(CURRENT_MESSAGE);
        assertThat(existing.getValue().getMessageContent()).isEqualTo(CURRENT_MESSAGE);
        assertThat(request.getValue().getClientRequestId()).isEqualTo("71_72");
        assertThat(request.getValue().getResourceList()).hasSize(1);
        assertThat(persisted.getValue().getMetadata()).isEqualTo(turn.getInputMetadata());
        assertThat(persisted.getValue().getCreatorId()).isEqualTo(30L);
        verify(messages, never()).selectBySessionId(any());
    }

    @Test
    void completedTaskReplyRunsDirectlyInOriginalSessionWithVisibleTransport() throws Exception {
        JSONObject input = JSON.parseObject(turn.getInputContent());
        input.put("已完成任务的公开成果", "先前发布的新闻报告");
        turn.setInputContent(input.toJSONString());
        turn.setPhase("CHAT_CONTINUATION");
        turn.setDisposition("CHAT");
        ByaiGroupChatTask task = new ByaiGroupChatTask();
        task.setStatus("PUBLISHED");
        when(tasks.selectById(60L)).thenReturn(task);
        executor.executeTurn(turn);
        ArgumentCaptor<AssistantChatDto> request = ArgumentCaptor.forClass(AssistantChatDto.class);
        verify(script).startExistingMessageTurn(request.capture(), any());
        verify(script, never()).startExistingMessageTurn(any(), any(), eq(true));
        assertThat(request.getValue().getSessionId()).isEqualTo(60L);
        assertThat(request.getValue().getChatContent()).isEqualTo(CURRENT_MESSAGE);
        ChatProcessContext ctx = context(60L);
        when(turns.selectByTrace(ctx.traceId)).thenReturn(turn);
        String content = (String) executor.decorate(ctx, CURRENT_MESSAGE, new HashMap<>());
        assertThat(content).startsWith(CURRENT_MESSAGE + "\n\n")
            .contains("群聊追问", turn.getInputContent(), "请在群里直接 @我")
            .doesNotContain("group-chat-disposition.json", "[任务交付提醒]");
        assertThat(task.getStatus()).isEqualTo("PUBLISHED");
    }

    @Test
    void eachContinuedTurnUsesItsOwnDispatchAndPublicBoundary() {
        turn.setTraceId(ScriptService.getTraceId(71L, 72L));
        ChatProcessContext ctx = context(60L);
        when(turns.selectByTrace(ctx.traceId)).thenReturn(turn);
        Map<String, Object> params = new HashMap<>();
        String content = (String) executor.decorate(ctx, CURRENT_MESSAGE, params);
        assertThat(content).contains("\"dispatchId\":\"52\"");
        verify(tokens).issue(10L, 60L, 30L, 40L, 68L);
        turn.setPhase("CHAT_CONTINUATION");
        assertThat((String) executor.decorate(ctx, CURRENT_MESSAGE, params))
            .startsWith(CURRENT_MESSAGE + "\n\n").contains("不要重新执行原始任务", turn.getInputContent())
            .doesNotContain("group-chat-disposition.json", "[任务交付提醒]");
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

    @Test
    void userJsonAndWhitespaceRemainVerbatimInsideTheDispatchEnvelope() throws Exception {
        String original = "  @A\n{\"本次消息\":\"用户自己的 JSON\",\"原始用户需求\":\"原文\"}  ";
        JSONObject input = JSON.parseObject(turn.getInputContent());
        input.put("本次发送者类型", "USER");
        input.put("本次发送者ID", 30L);
        input.put("本次消息", original);
        turn.setInputContent(input.toJSONString());
        executor.executeTurn(turn);
        ArgumentCaptor<ByaiMessage> persisted = ArgumentCaptor.forClass(ByaiMessage.class);
        verify(messages).insert(persisted.capture());
        assertThat(persisted.getValue().getMessageContent()).isEqualTo(original);
    }

    @Test
    void unboundRecoveryReusesMatchingOriginalMessageWithoutDuplicateInsertion() throws Exception {
        ByaiMessage child = new ByaiMessage();
        child.setMessageId(71L);
        child.setSessionId(60L);
        child.setCreatorId(30L);
        child.setUsage(1);
        child.setMessageContent(CURRENT_MESSAGE);
        when(messages.selectByMessageId(71L)).thenReturn(child);
        executor.executeTurn(turn);
        verify(messages, never()).insert(any(ByaiMessage.class));
        ArgumentCaptor<AssistantChatDto> request = ArgumentCaptor.forClass(AssistantChatDto.class);
        verify(script).startExistingMessageTurn(request.capture(), any());
        assertThat(request.getValue().getChatContent()).isEqualTo(CURRENT_MESSAGE);
    }

    @Test
    void missingCurrentMessageIsRejectedBeforePersistenceOrDispatch() throws Exception {
        turn.setInputContent("{\"原始用户需求\":\"背景\"}");
        assertThatThrownBy(() -> executor.executeTurn(turn)).isInstanceOf(IllegalArgumentException.class);
        verify(messages, never()).insert(any(ByaiMessage.class));
        verify(script, never()).startExistingMessageTurn(any(), any());
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
