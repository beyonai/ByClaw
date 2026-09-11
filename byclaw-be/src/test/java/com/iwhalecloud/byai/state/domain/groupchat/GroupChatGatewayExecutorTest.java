package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Map;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import com.iwhaleai.byai.framework.client.GatewayClient;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatExecution;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.chat.service.TargetAgentResolver;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatContextTokenService;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatDispatchPromptBuilder;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatGatewayExecutor;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatMemberUidCodec;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.state.domain.session.enums.MemObjType;

class GroupChatGatewayExecutorTest {

    @Test
    void executeUsesCandidateSessionForRuntimeAndSourceGroupForContext() {
        GatewayClient gatewayClient = mock(GatewayClient.class);
        ByaiMessageMapper messageMapper = mock(ByaiMessageMapper.class);
        UserService userService = mock(UserService.class);
        SsResourceService resourceService = mock(SsResourceService.class);
        TargetAgentResolver targetAgentResolver = mock(TargetAgentResolver.class);
        GroupChatContextTokenService tokenService = mock(GroupChatContextTokenService.class);
        GroupChatDispatchPromptBuilder promptBuilder = new GroupChatDispatchPromptBuilder();
        SessionMemberService memberService = mock(SessionMemberService.class);
        GroupChatGatewayExecutor executor = new GroupChatGatewayExecutor(gatewayClient, messageMapper, userService,
            resourceService, targetAgentResolver, tokenService, promptBuilder, memberService,
            new GroupChatMemberUidCodec());

        ByaiMessage source = new ByaiMessage();
        source.setMessageId(20L);
        source.setMessageContent("请生成报告");
        Users initiator = mock(Users.class);
        SsResource agent = mock(SsResource.class);
        when(messageMapper.selectByMessageId(20L)).thenReturn(source);
        when(userService.findById(30L)).thenReturn(initiator);
        when(resourceService.findById(40L)).thenReturn(agent);
        SsResource memberAgent = mock(SsResource.class);
        when(memberAgent.getResourceName()).thenReturn("其他智能体");
        when(memberService.findSessionMembers(10L, null, null)).thenReturn(List.of(
            member(MemObjType.USER.name(), 30L), member(MemObjType.AGENT.name(), 40L),
            member(MemObjType.AGENT.name(), 41L)));
        when(resourceService.findById(41L)).thenReturn(memberAgent);
        when(initiator.getUserCode()).thenReturn("user-30");
        when(initiator.getUserName()).thenReturn("用户三十");
        when(agent.getWorkerAgentType()).thenReturn("BYCLAW_EXE");
        when(targetAgentResolver.resolveAgentType("BYCLAW_EXE", 40L, null, "user-30"))
            .thenReturn("BYCLAW_EXE_user-30");
        when(tokenService.issue(10L, 60L, 30L, 40L, 20L)).thenReturn("signed-context-token");
        when(gatewayClient.sendMessage(anyString(), anyString(), any(), anyString(), anyString(), anyString(),
            anyString(), anyString(), anyString(), any(), any())).thenReturn(mock(GatewayClient.SendResponse.class));

        ByaiGroupChatExecution execution = new ByaiGroupChatExecution();
        execution.setExecutionId(50L);
        execution.setGroupSessionId(10L);
        execution.setSourceMessageId(20L);
        execution.setReplyToMessageId(19L);
        execution.setRootMessageId(18L);
        execution.setInitiatorUserId(30L);
        execution.setTargetAgentId(40L);
        execution.setCandidateSessionId(60L);
        execution.setGatewaySessionId("60");
        execution.setTraceId("trace-50");

        executor.execute(execution, "/by/.sessions/60");

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> paramsCaptor = (ArgumentCaptor) ArgumentCaptor.forClass(Map.class);
        verify(gatewayClient).sendMessage(eq("BYCLAW_EXE_user-30"), eq("60"), any(), eq("user-30"),
            eq("用户三十"), eq("ASK_AGENT"), eq("-1"), eq("20"), eq("trace-50"), paramsCaptor.capture(),
            eq(Map.of("scene", "GROUP_CHAT")));

        assertThat(paramsCaptor.getValue().get("groupChat")).isEqualTo(Map.of(
            "schemaVersion", "byclaw.group-chat-ref/v1",
            "conversationKey", "10",
            "beforeMessageId", "20",
            "contextToken", "signed-context-token",
            "childSessionId", 60L,
            "initiatorUserId", 30L,
            "targetAgentId", 40L));
        assertThat(paramsCaptor.getValue().get("cwd")).isEqualTo("/by/.sessions/60");
        ArgumentCaptor<String> contentCaptor = ArgumentCaptor.forClass(String.class);
        verify(gatewayClient).sendMessage(eq("BYCLAW_EXE_user-30"), eq("60"), contentCaptor.capture(), eq("user-30"),
            eq("用户三十"), eq("ASK_AGENT"), eq("-1"), eq("20"), eq("trace-50"), any(),
            eq(Map.of("scene", "GROUP_CHAT")));
        assertThat(contentCaptor.getValue()).contains("用户三十", "HUMAN_30", "其他智能体", "DIG_EMPLOYEE_41",
            "[@成员名称](uid?=目标成员uid)").doesNotContain("DIG_EMPLOYEE_40");
    }

    private ByaiSessionMember member(String type, Long id) {
        ByaiSessionMember member = new ByaiSessionMember();
        member.setMemObjType(type);
        member.setMemObjId(id);
        return member;
    }
}
