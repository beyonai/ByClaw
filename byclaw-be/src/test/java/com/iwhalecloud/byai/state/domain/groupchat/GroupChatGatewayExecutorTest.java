package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
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

import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxUserContextRunner;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatExecution;
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
import com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

class GroupChatGatewayExecutorTest {
    private ScriptService script;
    private ByaiMessageMapper messages;
    private ByaiGroupChatExecutionMapper executions;
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
        assertThat(decorated).contains("group-chat-disposition.json", "HUMAN_30", "用户三十");
        assertThat(child.getMessageContent()).doesNotContain("group-chat-disposition.json");
        Map<?, ?> groupChat = (Map<?, ?>) params.get("groupChat");
        assertThat(groupChat.get("contextToken")).isEqualTo("signed-context-token");
        assertThat(groupChat.get("conversationKey")).isEqualTo("10");
        assertThat(groupChat.get("beforeMessageId")).isEqualTo("20");
        assertThat(params).containsEntry("cwd", "/by/.sessions/60");
        context.traceId = ScriptService.getTraceId(81L, 82L);
        assertThat(executor.decorate(context, "继续", params)).isEqualTo("继续");
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
