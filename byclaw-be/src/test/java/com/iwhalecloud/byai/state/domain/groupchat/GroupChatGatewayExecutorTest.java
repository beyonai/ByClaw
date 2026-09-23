package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.ArrayList;
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
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextRequest;
import com.iwhalecloud.byai.state.domain.chat.service.ChatTurnPreparationException;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxUserContextRunner;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatExecution;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatExecutionMapper;
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
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

class GroupChatGatewayExecutorTest {
    private final ByaiGroupChatTaskMapper tasks = mock(ByaiGroupChatTaskMapper.class);
    private ScriptService script;
    private ByaiMessageMapper messages;
    private ByaiGroupChatExecutionMapper executions;
    private final GroupChatSessionContextFileService historyFiles = mock(GroupChatSessionContextFileService.class);
    private final GroupChatTaskAuthorizationService taskAuthorization = mock(GroupChatTaskAuthorizationService.class);
    private GroupChatGatewayExecutor executor;
    private ByaiGroupChatExecution execution;
    private ByaiMessage child;

    @BeforeEach
    void setUp() {
        script = mock(ScriptService.class);
        messages = mock(ByaiMessageMapper.class);
        executions = mock(ByaiGroupChatExecutionMapper.class);
        UserService users = mock(UserService.class);
        SsResourceService resources = mock(SsResourceService.class);
        GroupChatContextTokenService tokens = mock(GroupChatContextTokenService.class);
        SessionMemberService members = mock(SessionMemberService.class);
        SequenceService sequences = mock(SequenceService.class);
        SandboxUserContextRunner runner = mock(SandboxUserContextRunner.class);
        executor = new GroupChatGatewayExecutor(script, messages, users, resources, tokens,
            new GroupChatDispatchPromptBuilder(), members, new GroupChatMemberUidCodec(), executions, sequences, runner);
        executor.configureTurnTransactions(mock(PlatformTransactionManager.class), tasks);
        executor.configureContextFiles(historyFiles, taskAuthorization);
        when(historyFiles.prepareGroupHistory(any(), any(), any(), any()))
            .thenReturn(new GroupChatSessionContextFileService.ContextFile(
                "GROUP_PUBLIC", "/by/.sessions/60/.byclaw/context/turn/group-history.json", "20"));
        Users user = new Users();
        user.setUserCode("user30");
        user.setUserName("用户三十");
        when(users.findById(30L)).thenReturn(user);
        when(resources.findById(40L)).thenReturn(new SsResource());
        when(tokens.issue(10L, 60L, 30L, 40L, 20L)).thenReturn("signed-context-token");
        ByaiSessionMember member = new ByaiSessionMember();
        member.setMemObjId(30L);
        member.setMemObjType("USER");
        when(members.findSessionMembers(10L, null, null)).thenReturn(List.of(member));
        when(sequences.nextVal()).thenReturn(70L, 71L);
        when(executions.bindRuntime(eq(50L), any())).thenReturn(1);
        doAnswer(invocation -> { invocation.getArgument(1, Runnable.class).run(); return null; })
            .when(runner).runAsUser(eq("user30"), any());
        execution = new ByaiGroupChatExecution();
        execution.setExecutionId(50L);
        execution.setGroupSessionId(10L);
        execution.setSourceMessageId(20L);
        execution.setInitiatorUserId(30L);
        execution.setTargetAgentId(40L);
        execution.setCandidateSessionId(60L);
        execution.setStatus("RUNNING");
        child = new ByaiMessage();
        child.setSessionId(60L);
        child.setMessageId(61L);
        child.setCreatorId(30L);
        child.setUsage(1);
        child.setMessageContent("{{DIG_EMPLOYEE_40}} 请生成报告");
        child.setMetadata("{\"scene\":\"GROUP_TASK\",\"resourceList\":[{\"resourceType\":\"DIG_EMPLOYEE\",\"resourceId\":\"40\",\"resourceName\":\"报告助理\"}]}");
        when(messages.selectBySessionId(60L)).thenReturn(List.of(child));
        when(executions.selectByCandidateSessionId(60L)).thenReturn(execution);
    }

    @Test
    void startsNormalRuntimeWithExistingMessageAndDurableTraceBeforeSending() throws Exception {
        executor.execute(execution, "/by/.sessions/60");
        ArgumentCaptor<AssistantChatDto> dto = ArgumentCaptor.forClass(AssistantChatDto.class);
        ArgumentCaptor<ByaiMessageHotDtoDto> existing = ArgumentCaptor.forClass(ByaiMessageHotDtoDto.class);
        InOrder order = Mockito.inOrder(executions, script);
        order.verify(executions).bindRuntime(50L, ScriptService.getTraceId(61L, 70L));
        order.verify(script).startExistingMessageTurn(dto.capture(), existing.capture());
        assertThat(dto.getValue().getClientRequestId()).isEqualTo("61_70");
        assertThat(dto.getValue().getLlmMessageId()).isEqualTo(70L);
        assertThat(dto.getValue().getSessionId()).isEqualTo(60L);
        assertThat(dto.getValue().getChatContent()).isEqualTo(child.getMessageContent());
        assertThat(dto.getValue().getResourceList()).hasSize(1);
        assertThat(existing.getValue().getMessageId()).isEqualTo(61L);
        assertThat(existing.getValue().getMetadata()).isEqualTo(child.getMetadata());
    }

    @Test
    void decoratesOnlyEgressAndRetainsFrozenParentForLaterTurns() {
        execution.setTraceId(ScriptService.getTraceId(61L, 70L));
        ChatProcessContext context = new ChatProcessContext(null, new AssistantChatDto());
        context.sessionId = 60L;
        context.userId = 30L;
        context.assistantChatDto.setAgentId(40L);
        context.traceId = execution.getTraceId();
        Map<String, Object> params = new HashMap<>();
        params.put("groupChat", Map.of("conversationKey", "60"));
        String decorated = (String) executor.decorate(context, child.getMessageContent(), params);
        assertThat(decorated).contains("group-chat-disposition.json", "HUMAN_30", "用户三十", "[任务交付提醒]", "/by/.sessions/60/.byclaw/task-delivery.json");
        assertThat(child.getMessageContent()).doesNotContain("group-chat-disposition.json");
        Map<?, ?> groupChat = (Map<?, ?>) params.get("groupChat");
        assertThat(groupChat.get("contextToken")).isEqualTo("signed-context-token");
        assertThat(groupChat.get("conversationKey")).isEqualTo("10");
        assertThat(groupChat.get("beforeMessageId")).isEqualTo("20");
        assertThat(params).containsEntry("cwd", "/by/.sessions/60");
        context.traceId = ScriptService.getTraceId(81L, 82L);
        assertThat((String) executor.decorate(context, "继续", params)).startsWith("继续")
            .contains("group-history.json").doesNotContain("TASK_PRIVATE", "beforeMessageId", "truncation");
    }

    @Test
    void directTaskFollowupUsesPublicBoundaryInsteadOfPrivateForkTrigger() {
        execution.setStatus("CONVERSATION");
        execution.setSourceMessageId(999L);
        execution.setReplyToMessageId(20L);
        ChatProcessContext context = new ChatProcessContext(null, new AssistantChatDto());
        context.sessionId = 60L;
        context.userId = 30L;
        context.assistantChatDto.setAgentId(40L);
        context.traceId = ScriptService.getTraceId(81L, 82L);
        Map<String, Object> params = new HashMap<>();
        assertThat((String) executor.decorate(context, "继续任务", params)).startsWith("继续任务");
        Map<?, ?> reference = (Map<?, ?>) params.get("groupChat");
        assertThat(reference.get("beforeMessageId")).isEqualTo("20");
        assertThat(reference.get("contextToken")).isEqualTo("signed-context-token");
    }

    @Test
    void onlyActivePrivateTaskFollowupsReceiveDeliveryReminderWithoutReclassification() {
        execution.setStatus("CONVERSATION");
        ByaiGroupChatTask task = new ByaiGroupChatTask();
        task.setStatus("ACTIVE");
        when(tasks.selectById(60L)).thenReturn(task);
        ChatProcessContext context = new ChatProcessContext(null, new AssistantChatDto());
        context.sessionId = 60L;
        context.userId = 30L;
        context.assistantChatDto.setAgentId(40L);
        context.userMessageId = 81L;
        context.assistantChatDto.setChatContent("修改报告");
        context.traceId = ScriptService.getTraceId(81L, 82L);
        String content = (String) executor.decorate(context, "修改报告", new HashMap<>());
        assertThat(content).startsWith("修改报告").contains("[任务交付提醒]", "/by/.sessions/60/.byclaw/task-delivery.json")
            .doesNotContain("群聊判定协议", "group-chat-disposition.json");
        assertThat(context.assistantChatDto.getChatContent()).isEqualTo("修改报告");
        for (String status : List.of("PUBLISHED", "CANCELLED")) {
            task.setStatus(status);
            doThrow(new IllegalArgumentException("Group task does not accept a new turn"))
                .when(taskAuthorization).requireActiveAgent(60L, 40L);
            assertThatThrownBy(() -> executor.decorate(context, "修改报告", new HashMap<>()))
                .isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Test
    void privateTaskCanSwitchAgentsWhileKeepingOriginalGroupReferenceAndPublicationOwner() {
        execution.setStatus("CONVERSATION");
        execution.setTraceId(ScriptService.getTraceId(61L, 70L));
        ByaiGroupChatTask task = new ByaiGroupChatTask();
        task.setStatus("ACTIVE");
        task.setTargetAgentId(40L);
        when(tasks.selectById(60L)).thenReturn(task);
        ChatProcessContext context = new ChatProcessContext(null, new AssistantChatDto());
        context.sessionId = 60L;
        context.userId = 30L;
        context.userMessageId = 81L;
        context.traceId = ScriptService.getTraceId(81L, 82L);
        when(historyFiles.prepareTaskHandoffHistory(eq("user30"), any(), eq(context.traceId), eq(81L)))
            .thenReturn(handoffHistory());
        when(messages.selectPreviousTaskAnswers(60L, 81L, 50))
            .thenReturn(List.of(answer(70L, 40L)), List.of(answer(80L, 41L)));
        for (Long agentId : List.of(41L, 40L)) {
            context.assistantChatDto.setAgentId(agentId);
            Map<String, Object> params = new HashMap<>();
            String result = (String) executor.decorate(context, "继续", params);
            assertThat(result).contains("task-history.jsonl", "group-history.json", "[任务交付提醒]", "/by/.sessions/60/.byclaw/task-delivery.json").doesNotContain("群聊判定协议");
            assertThat(((Map<?, ?>) params.get("groupChat")).get("targetAgentId")).isEqualTo(40L);
            verify(taskAuthorization).requireActiveAgent(60L, agentId);
        }
        assertThat(task.getTargetAgentId()).isEqualTo(40L);
        assertThat(execution.getTargetAgentId()).isEqualTo(40L);
    }

    @Test
    void sameAgentTaskContinuationDoesNotPrepareEitherHistoryFile() {
        ChatProcessContext context = taskContext(41L);
        when(messages.selectPreviousTaskAnswers(60L, 81L, 50)).thenReturn(List.of(answer(80L, 41L)));
        String content = (String) executor.decorate(context, "继续", new HashMap<>());
        assertThat(content).contains("[任务交付提醒]", "/by/.sessions/60/.byclaw/task-delivery.json").doesNotContain("任务接手上下文", "群聊历史", ".byclaw/context");
        verifyNoInteractions(historyFiles);
    }

    @Test
    void originalAgentContinuationWithoutHistoricalIdentityDoesNotPrepareFiles() {
        ChatProcessContext context = taskContext(40L);
        assertThat((String) executor.decorate(context, "继续", new HashMap<>())).doesNotContain("任务接手上下文");
        verifyNoInteractions(historyFiles);
    }

    @Test
    void failedPreparationDoesNotCountAsAnAgentHandoffOnRetry() {
        ChatProcessContext context = taskContext(41L);
        ByaiMessage failed = answer(80L, 41L);
        failed.setMessageContent("");
        failed.setMetadata("{\"agentId\":\"41\",\"turnFailed\":true}");
        when(messages.selectPreviousTaskAnswers(60L, 81L, 50)).thenReturn(List.of(failed, answer(70L, 40L)));
        when(historyFiles.prepareTaskHandoffHistory(any(), any(), any(), any())).thenReturn(handoffHistory());
        assertThat((String) executor.decorate(context, "重试", new HashMap<>())).contains("任务接手上下文");
        verify(historyFiles).prepareTaskHandoffHistory(eq("user30"), any(), eq(context.traceId), eq(81L));
        verify(historyFiles, never()).prepareGroupHistory(any(), any(), any(), any());
    }

    @Test
    void switchingBackSearchesPastFullPageOfFailedAttemptsBeforeFallingBackToOriginalAgent() {
        ChatProcessContext context = taskContext(40L);
        List<ByaiMessage> failedAttempts = new ArrayList<>();
        for (long id = 80; id >= 31; id--) {
            ByaiMessage failed = answer(id, 40L);
            failed.setMessageContent("");
            failed.setMetadata("{\"agentId\":\"40\",\"turnFailed\":true}");
            failedAttempts.add(failed);
        }
        when(messages.selectPreviousTaskAnswers(60L, 81L, 50)).thenReturn(failedAttempts);
        when(messages.selectPreviousTaskAnswers(60L, 31L, 50)).thenReturn(List.of(answer(30L, 41L)));
        when(historyFiles.prepareTaskHandoffHistory(any(), any(), any(), any())).thenReturn(handoffHistory());

        assertThat((String) executor.decorate(context, "重试接手", new HashMap<>())).contains("任务接手上下文");

        verify(messages).selectPreviousTaskAnswers(60L, 31L, 50);
        verify(historyFiles).prepareTaskHandoffHistory(eq("user30"), any(), eq(context.traceId), eq(81L));
    }

    @Test
    void failedAgentHistoryLookupBlocksDispatchInsteadOfAssumingSameAgent() {
        ChatProcessContext context = taskContext(41L);
        when(messages.selectPreviousTaskAnswers(60L, 81L, 50)).thenThrow(new IllegalStateException("database"));
        assertThatThrownBy(() -> executor.decorate(context, "继续", new HashMap<>()))
            .isInstanceOf(ChatTurnPreparationException.class).hasMessageContaining("请重试");
        verifyNoInteractions(historyFiles);
    }

    private ChatProcessContext taskContext(Long agentId) {
        execution.setStatus("CONVERSATION");
        execution.setTraceId(ScriptService.getTraceId(61L, 70L));
        ByaiGroupChatTask task = new ByaiGroupChatTask();
        task.setStatus("ACTIVE");
        task.setTargetAgentId(40L);
        when(tasks.selectById(60L)).thenReturn(task);
        ChatProcessContext context = new ChatProcessContext(null, new AssistantChatDto());
        context.sessionId = 60L;
        context.userId = 30L;
        context.userMessageId = 81L;
        context.traceId = ScriptService.getTraceId(81L, 82L);
        context.assistantChatDto.setAgentId(agentId);
        return context;
    }

    private ByaiMessage answer(Long messageId, Long agentId) {
        ByaiMessage message = new ByaiMessage();
        message.setMessageId(messageId);
        message.setMessageContent("已完成的正文");
        message.setMetadata("{\"agentId\":\"" + agentId + "\"}");
        return message;
    }

    private GroupChatSessionContextFileService.TaskHandoffHistory handoffHistory() {
        return new GroupChatSessionContextFileService.TaskHandoffHistory(
            new GroupChatSessionContextFileService.ContextFile("GROUP_PUBLIC", "/by/group-history.json", "20"),
            new GroupChatSessionContextFileService.ContextFile("TASK_PRIVATE", "/by/task-history.jsonl", "81"));
    }

    @Test
    void initialDispatchCannotSwitchItsAgent() {
        execution.setTraceId(ScriptService.getTraceId(61L, 70L));
        ChatProcessContext context = new ChatProcessContext(null, new AssistantChatDto());
        context.sessionId = 60L;
        context.userId = 30L;
        context.traceId = execution.getTraceId();
        context.assistantChatDto.setAgentId(41L);
        assertThatThrownBy(() -> executor.decorate(context, "继续", new HashMap<>()))
            .hasMessageContaining("identity does not match");
        verifyNoInteractions(historyFiles);
    }

    @Test
    void filePreparationFailureStopsDecorationWithRetryableError() {
        ChatProcessContext context = new ChatProcessContext(null, new AssistantChatDto());
        context.sessionId = 60L;
        context.userId = 30L;
        context.userMessageId = 81L;
        context.traceId = ScriptService.getTraceId(81L, 82L);
        context.assistantChatDto.setAgentId(40L);
        when(historyFiles.prepareGroupHistory(eq("user30"), any(), eq(context.traceId), eq(81L)))
            .thenThrow(new ChatTurnPreparationException("历史上下文准备失败，请重试", new IllegalStateException("storage")));
        assertThatThrownBy(() -> executor.decorate(context, "继续", new HashMap<>()))
            .isInstanceOf(ChatTurnPreparationException.class).hasMessageContaining("请重试");
    }

    @Test
    void attachmentPayloadReceivesPromptWithoutChangingOriginalContent() {
        execution.setTraceId(ScriptService.getTraceId(61L, 70L));
        ChatProcessContext context = new ChatProcessContext(null, new AssistantChatDto());
        context.sessionId = 60L;
        context.userId = 30L;
        context.userMessageId = 61L;
        context.traceId = execution.getTraceId();
        context.assistantChatDto.setAgentId(40L);
        JSONArray content = JSON.parseArray("[{\"role\":\"user\",\"content\":{\"text\":\"分析附件\",\"files\":[{\"name\":\"report.txt\"}]}}]");
        JSONArray decorated = (JSONArray) executor.decorate(context, content, new HashMap<>());
        assertThat(decorated.getJSONObject(0).getJSONObject("content").getString("text"))
            .contains("群聊判定协议");
        assertThat(content.getJSONObject(0).getJSONObject("content").getString("text")).isEqualTo("分析附件");
        assertThat(decorated.getJSONObject(0).getJSONObject("content").getJSONArray("files"))
            .isEqualTo(content.getJSONObject(0).getJSONObject("content").getJSONArray("files"));
    }

    @Test
    void ordinarySessionRequestIsUnchanged() {
        ChatProcessContext context = new ChatProcessContext(null, new AssistantChatDto());
        context.sessionId = 99L;
        Map<String, Object> params = new HashMap<>();
        assertThat(executor.decorate(context, "hello", params)).isEqualTo("hello");
        assertThat(params).isEmpty();
        verify(executions).selectByCandidateSessionId(99L);
    }
}
