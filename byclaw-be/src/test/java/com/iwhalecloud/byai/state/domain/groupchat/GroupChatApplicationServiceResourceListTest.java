package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectMemberService;
import com.iwhalecloud.byai.manager.application.service.devloop.ProjectApplicationService;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatApplicationService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatExecutionCoordinator;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatMentionService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;
import com.iwhalecloud.byai.state.domain.session.enums.MemObjType;
import com.iwhalecloud.byai.state.domain.session.service.SessionExtService;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.state.domain.ws.model.ChatMessage;

class GroupChatApplicationServiceResourceListTest {
    private static final Long GROUP_ID = 100L;
    private static final Long MESSAGE_ID = 200L;
    private static final Long USER_ID = 300L;

    private final GroupChatAuthorizationService authorizationService = mock(GroupChatAuthorizationService.class);
    private final SessionMemberService memberService = mock(SessionMemberService.class);
    private final SequenceService sequenceService = mock(SequenceService.class);
    private final ByaiMessageMapper messageMapper = mock(ByaiMessageMapper.class);
    private final ProjectMemberService projectMemberService = mock(ProjectMemberService.class);
    private final GroupChatExecutionCoordinator executionCoordinator = mock(GroupChatExecutionCoordinator.class);
    private final GroupChatEventPublisher eventPublisher = mock(GroupChatEventPublisher.class);
    private final GroupChatMentionService mentionService = mock(GroupChatMentionService.class);
    private GroupChatApplicationService service;

    @BeforeEach
    void setUp() {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(USER_ID);
        loginInfo.setUserName("群成员");
        CurrentUserHolder.setLoginInfo(loginInfo);

        ByaiSession session = new ByaiSession();
        session.setSessionId(GROUP_ID);
        session.setProjectId(400L);
        when(authorizationService.requireGroup(GROUP_ID)).thenReturn(session);
        when(authorizationService.requireCurrentUserMember(GROUP_ID)).thenReturn(new ByaiSessionMember());
        when(sequenceService.nextVal()).thenReturn(MESSAGE_ID);
        service = new GroupChatApplicationService(mock(SessionService.class), sequenceService, authorizationService,
            memberService, mock(ProjectApplicationService.class), projectMemberService, messageMapper,
            executionCoordinator, eventPublisher, mock(SessionExtService.class), mentionService);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void rejectedContinuationNeverBroadcastsTheRolledBackUserMessage() {
        when(memberService.findSessionMember(GROUP_ID, MemObjType.AGENT.name(), 501L))
            .thenReturn(new ByaiSessionMember());
        when(executionCoordinator.enqueue(eq(GROUP_ID), eq(MESSAGE_ID), any(), eq(USER_ID), eq(501L), any(), any()))
            .thenThrow(new IllegalArgumentException("Unfinished tasks require task entry"));
        assertThatThrownBy(() -> service.acceptUserMessage(command(List.of(
            resource(AgentMetaEnum.DIG_EMPLOYEE, "501", "DIG_EMPLOYEE_501")))))
            .isInstanceOf(IllegalArgumentException.class);
        verify(eventPublisher, never()).publish(any(), any(), any());
    }

    @Test
    void userBroadcastWaitsForSuccessfulCommitOfQueueRegistration() {
        TransactionSynchronizationManager.initSynchronization();
        try {
            service.acceptUserMessage(command(List.of()));
            verify(eventPublisher, never()).publish(any(), any(), any());
            for (TransactionSynchronization synchronization : TransactionSynchronizationManager.getSynchronizations()) {
                synchronization.afterCommit();
            }
            verify(eventPublisher).publish(eq(GROUP_ID), any(), isNull());
        }
        finally {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    @Test
    void persistsFullResourceListAndDispatchesEachDistinctDigitalEmployeeOnce() {
        ResourceVo firstAgent = resource(AgentMetaEnum.DIG_EMPLOYEE, "501", "DIG_EMPLOYEE_ignored");
        ResourceVo user = resource(AgentMetaEnum.HUMAN, "601", "HUMAN_ignored");
        ResourceVo duplicateAgent = resource(AgentMetaEnum.DIG_EMPLOYEE, "501", "DIG_EMPLOYEE_other");
        when(memberService.findSessionMember(GROUP_ID, MemObjType.AGENT.name(), 501L))
            .thenReturn(new ByaiSessionMember());
        when(memberService.findSessionMember(GROUP_ID, MemObjType.USER.name(), 601L))
            .thenReturn(new ByaiSessionMember());
        ChatMessage command = command(List.of(firstAgent, user, duplicateAgent));
        command.setClientRequestId("broadcast-before-ack");

        assertThat(service.acceptUserMessage(command)).isEqualTo(MESSAGE_ID);

        ArgumentCaptor<ByaiMessage> messageCaptor = ArgumentCaptor.forClass(ByaiMessage.class);
        verify(messageMapper).insert(messageCaptor.capture());
        JSONObject metadata = JSON.parseObject(messageCaptor.getValue().getMetadata());
        assertThat(metadata.getJSONArray("resourceList")).hasSize(3);
        assertThat(metadata.containsKey("mentions")).isFalse();
        ArgumentCaptor<JSONObject> eventCaptor = ArgumentCaptor.forClass(JSONObject.class);
        verify(eventPublisher).publish(eq(GROUP_ID), eventCaptor.capture(), isNull());
        JSONObject event = eventCaptor.getValue();
        assertThat(event.getJSONArray("resourceList")).hasSize(3);
        assertThat(event.getString("clientRequestId")).isEqualTo("broadcast-before-ack");
        assertThat(event.getJSONArray("resourceList").getJSONObject(0).getString("resourceId")).isEqualTo("501");
        assertThat(event.getJSONArray("resourceList").getJSONObject(1).getString("resourceId")).isEqualTo("601");
        assertThat(event.containsKey("mentions")).isFalse();
        // 组合 id 不参与成员解析，两个引用都应按 resourceId 收敛到同一个数字员工。
        verify(executionCoordinator, times(1)).enqueue(GROUP_ID, MESSAGE_ID, null, USER_ID, 501L, null,
            MESSAGE_ID);
    }

    @Test
    void humanResourcePersistsWithoutDispatchingAgent() {
        when(memberService.findSessionMember(GROUP_ID, MemObjType.USER.name(), 601L))
            .thenReturn(new ByaiSessionMember());

        service.acceptUserMessage(command(List.of(resource(AgentMetaEnum.HUMAN, "601", "HUMAN_999"))));

        verify(messageMapper).insert(any(ByaiMessage.class));
        verify(mentionService).indexHumanMentions(eq(GROUP_ID), eq(MESSAGE_ID), eq(USER_ID), eq(USER_ID), any());
        verify(executionCoordinator, never()).enqueue(any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void invitedUserStartsReadingAfterExistingGroupHistory() {
        when(projectMemberService.isMember(400L, 601L)).thenReturn(true);
        when(messageMapper.selectLatestMessageId(GROUP_ID)).thenReturn(199L);

        service.invite(GROUP_ID, MemObjType.USER.name(), 601L);

        ArgumentCaptor<ByaiSessionMember> memberCaptor = ArgumentCaptor.forClass(ByaiSessionMember.class);
        verify(memberService).save(memberCaptor.capture());
        assertThat(memberCaptor.getValue().getLastReadMessageId()).isEqualTo(199L);
        assertThat(memberCaptor.getValue().getLastReadTime()).isNotNull();
    }

    @Test
    void idempotentRetryDoesNotPersistBroadcastOrDispatchAgain() {
        ResourceVo agent = resource(AgentMetaEnum.DIG_EMPLOYEE, "501", "DIG_EMPLOYEE_501");
        when(memberService.findSessionMember(GROUP_ID, MemObjType.AGENT.name(), 501L))
            .thenReturn(new ByaiSessionMember());
        ByaiMessage existing = new ByaiMessage();
        existing.setMessageId(MESSAGE_ID);
        when(messageMapper.selectGroupMessageByClientRequestId(GROUP_ID, "request-1"))
            .thenReturn(null, existing);
        ChatMessage command = command(List.of(agent));
        command.setClientRequestId("request-1");

        assertThat(service.acceptUserMessage(command)).isEqualTo(MESSAGE_ID);
        assertThat(service.acceptUserMessage(command)).isEqualTo(MESSAGE_ID);

        verify(messageMapper, times(1)).insert(any(ByaiMessage.class));
        verify(eventPublisher, times(1)).publish(eq(GROUP_ID), any(JSONObject.class), isNull());
        verify(executionCoordinator, times(1)).enqueue(GROUP_ID, MESSAGE_ID, null, USER_ID, 501L, null,
            MESSAGE_ID);
    }

    @Test
    void rejectsUnsupportedResourceTypeBeforePersisting() {
        assertThatThrownBy(() -> service.acceptUserMessage(
            command(List.of(resource(AgentMetaEnum.KG_DOC, "701", "KG_DOC_701")))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Unsupported group member resource type");

        verify(messageMapper, never()).insert(any(ByaiMessage.class));
    }

    @Test
    void rejectsMissingOrNonNumericResourceIdBeforePersisting() {
        assertThatThrownBy(() -> service.acceptUserMessage(
            command(List.of(resource(AgentMetaEnum.DIG_EMPLOYEE, "not-a-number", "DIG_EMPLOYEE_501")))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Invalid group member resource ID");
        assertThatThrownBy(() -> service.acceptUserMessage(
            command(List.of(resource(AgentMetaEnum.HUMAN, null, "HUMAN_601")))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Invalid group member resource ID");

        verify(messageMapper, never()).insert(any(ByaiMessage.class));
    }

    @Test
    void rejectsAgentAndHumanThatAreNotGroupMembers() {
        assertThatThrownBy(() -> service.acceptUserMessage(
            command(List.of(resource(AgentMetaEnum.DIG_EMPLOYEE, "501", "DIG_EMPLOYEE_501")))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Referenced resource is not a group member");
        assertThatThrownBy(() -> service.acceptUserMessage(
            command(List.of(resource(AgentMetaEnum.HUMAN, "601", "HUMAN_601")))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Referenced resource is not a group member");

        verify(messageMapper, never()).insert(any(ByaiMessage.class));
    }

    @Test
    void rejectsSameResourceIdWithConflictingMemberTypes() {
        when(memberService.findSessionMember(GROUP_ID, MemObjType.AGENT.name(), 501L))
            .thenReturn(new ByaiSessionMember());

        assertThatThrownBy(() -> service.acceptUserMessage(command(List.of(
            resource(AgentMetaEnum.DIG_EMPLOYEE, "501", "DIG_EMPLOYEE_501"),
            resource(AgentMetaEnum.HUMAN, "501", "HUMAN_501")))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Conflicting group member resource types");

        verify(messageMapper, never()).insert(any(ByaiMessage.class));
    }

    private ChatMessage command(List<ResourceVo> resources) {
        ChatMessage command = new ChatMessage();
        command.setSessionId(GROUP_ID);
        command.setChatContent("群消息");
        command.setResourceList(resources);
        return command;
    }

    private ResourceVo resource(AgentMetaEnum type, String resourceId, String id) {
        ResourceVo resource = new ResourceVo();
        resource.setResourceType(type);
        resource.setResourceId(resourceId);
        resource.setId(id);
        resource.setResourceName("成员");
        return resource;
    }
}
