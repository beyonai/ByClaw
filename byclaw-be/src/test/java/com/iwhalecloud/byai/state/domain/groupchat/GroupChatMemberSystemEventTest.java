package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.sql.Connection;
import java.sql.SQLException;
import javax.sql.DataSource;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.application.service.devloop.ProjectApplicationService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectMemberService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatApplicationService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatExecutionCoordinator;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatInvitationService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import com.iwhalecloud.byai.state.domain.session.service.SessionExtService;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** 成员和系统消息共用真实 Spring 事务边界，外部数据库通过 JDBC 连接替身观察提交结果。 */
class GroupChatMemberSystemEventTest {
    private final SessionService sessions = mock(SessionService.class);
    private final SessionMemberService members = mock(SessionMemberService.class);
    private final GroupChatAuthorizationService authorization = mock(GroupChatAuthorizationService.class);
    private final GroupChatInvitationService invitations = mock(GroupChatInvitationService.class);
    private final ByaiMessageMapper messages = mock(ByaiMessageMapper.class);
    private final GroupChatEventPublisher events = mock(GroupChatEventPublisher.class);
    private final GroupChatExecutionCoordinator coordinator = mock(GroupChatExecutionCoordinator.class);
    private final UserService users = mock(UserService.class);
    private final SsResourceService resources = mock(SsResourceService.class);
    private final Connection connection = mock(Connection.class);
    private GroupChatApplicationService service;

    @BeforeEach
    void setUp() throws Exception {
        LoginInfo login = new LoginInfo();
        login.setUserId(10L);
        CurrentUserHolder.setLoginInfo(login);
        ByaiSession group = new ByaiSession();
        group.setSessionId(200L);
        group.setProjectId(100L);
        group.setEnterpriseId(300L);
        when(authorization.requireGroup(200L)).thenReturn(group);
        when(sessions.findById(200L)).thenReturn(group);
        when(invitations.validateForMemberInvitation(200L, "Ab1234CD")).thenReturn(group);
        when(invitations.validatedInviterId(200L, "Ab1234CD")).thenReturn(40L);
        when(members.findSessionMember(200L, "USER", 10L)).thenReturn(member(10L, "USER", "群昵称"));
        Users invited = new Users();
        invited.setUserName("小李");
        when(users.findById(20L)).thenReturn(invited);
        Users inviter = new Users();
        inviter.setUserName("链接创建者");
        when(users.findById(40L)).thenReturn(inviter);
        SsResource agent = new SsResource();
        agent.setResourceName("助手");
        when(resources.findById(30L)).thenReturn(agent);
        SequenceService sequence = mock(SequenceService.class);
        when(sequence.nextVal()).thenReturn(501L, 502L, 503L);
        GroupChatApplicationService target = new GroupChatApplicationService(sessions, sequence, authorization, members,
            mock(ProjectApplicationService.class), mock(ProjectMemberService.class), messages, coordinator, events,
            mock(SessionExtService.class));
        ReflectionTestUtils.setField(target, "invitationService", invitations);
        ReflectionTestUtils.setField(target, "userService", users);
        ReflectionTestUtils.setField(target, "resourceService", resources);
        DataSource dataSource = mock(DataSource.class);
        when(dataSource.getConnection()).thenReturn(connection);
        when(connection.getAutoCommit()).thenReturn(true);
        doAnswer(invocation -> {
            // JDBC 提交发生时仍不得发布；只有成功返回后才允许执行提交回调。
            verifyNoInteractions(events);
            return null;
        }).when(connection).commit();
        TransactionInterceptor interceptor = new TransactionInterceptor();
        interceptor.setTransactionManager(new DataSourceTransactionManager(dataSource));
        interceptor.setTransactionAttributeSource(new AnnotationTransactionAttributeSource());
        ProxyFactory factory = new ProxyFactory(target);
        factory.setProxyTargetClass(true);
        factory.addAdvice(interceptor);
        service = (GroupChatApplicationService) factory.getProxy();
        doAnswer(invocation -> {
            assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isTrue();
            verify(connection, never()).commit();
            verifyNoInteractions(events);
            return 1;
        }).when(messages).insert(any(ByaiMessage.class));
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void humanInvitationPersistsNameSnapshotAndPublishesMatchingMessageAfterCommit() throws Exception {
        service.invite(200L, "USER", 20L);
        ByaiMessage saved = assertEvent("MEMBER_INVITED", "群昵称 邀请 小李 加入工作组", 10L, 20L, "USER");
        assertThat(saved.getEnterpriseId()).isEqualTo(300L);
        assertThat(saved.getProjectId()).isEqualTo(100L);
        assertThat(saved.getTaskId()).isNull();
    }

    @Test
    void agentInvitationUsesResourceNameWithoutStartingAgentExecution() throws Exception {
        service.invite(200L, "AGENT", 30L);
        assertEvent("MEMBER_INVITED", "群昵称 邀请 助手 加入工作组", 10L, 30L, "AGENT");
    }

    @Test
    void missingDisplayNameFallsBackToStableMemberId() throws Exception {
        service.invite(200L, "AGENT", 60L);
        assertEvent("MEMBER_INVITED", "群昵称 邀请 60 加入工作组", 10L, 60L, "AGENT");
    }

    @Test
    void linkJoinAttributesInvitationToPersistedLinkCreator() throws Exception {
        when(members.findSessionMember(200L, "USER", 10L)).thenReturn(null);
        Users joiner = new Users();
        joiner.setUserName("入群用户");
        when(users.findById(10L)).thenReturn(joiner);
        service.acceptInvitation(200L, "Ab1234CD");
        assertEvent("MEMBER_INVITED", "链接创建者 邀请 入群用户 加入工作组", 40L, 10L, "USER");
    }

    @Test
    void alreadyJoinedLinkDoesNotWriteOrPublishAgain() {
        service.acceptInvitation(200L, "Ab1234CD");
        verify(members, never()).save(any());
        verifyNoInteractions(messages, events, coordinator);
    }

    @Test
    void duplicateDirectInviteAndUnauthorizedInviteDoNotWriteEvents() {
        when(members.findSessionMember(200L, "USER", 20L)).thenReturn(member(20L, "USER", "小李"));
        assertThatThrownBy(() -> service.invite(200L, "USER", 20L)).hasMessage("Member already exists");
        doThrow(new IllegalArgumentException("Admin required")).when(authorization).requireInvite(200L, "AGENT");
        assertThatThrownBy(() -> service.invite(200L, "AGENT", 30L)).hasMessage("Admin required");
        verifyNoInteractions(messages, events, coordinator);
    }

    @Test
    void removalSnapshotsNicknameBeforeDeletingMember() throws Exception {
        when(members.findSessionMember(200L, "USER", 20L)).thenReturn(member(20L, "USER", "群内小李"));
        service.remove(200L, "USER", 20L);
        verify(members).deleteMember(20L);
        assertEvent("MEMBER_REMOVED", "群昵称 将 群内小李 移出工作组", 10L, 20L, "USER");
    }

    @Test
    void leavePersistsMemberNameAndPublishesAfterCommit() throws Exception {
        when(authorization.requireCurrentUserMember(200L)).thenReturn(member(10L, "USER", "群昵称"));
        service.leave(200L);
        verify(members).deleteMember(10L);
        assertEvent("MEMBER_LEFT", "群昵称 离开了工作组", 10L, 10L, "USER");
    }

    @Test
    void messageInsertFailureRollsBackMembershipAndDoesNotPublish() throws Exception {
        doThrow(new IllegalStateException("message insert failed")).when(messages).insert(any(ByaiMessage.class));
        assertThatThrownBy(() -> service.invite(200L, "USER", 20L)).hasMessage("message insert failed");
        verify(members).save(any());
        verify(connection).rollback();
        verify(connection, never()).commit();
        verifyNoInteractions(events, coordinator);
    }

    @Test
    void commitFailureDoesNotPublishRegisteredEvents() throws Exception {
        doThrow(new SQLException("commit failed")).when(connection).commit();
        assertThatThrownBy(() -> service.invite(200L, "AGENT", 30L)).hasRootCauseMessage("commit failed");
        verify(messages).insert(any(ByaiMessage.class));
        verifyNoInteractions(events, coordinator);
    }

    private ByaiMessage assertEvent(String eventType, String content, Long operatorId, Long memberId,
        String memberType) throws Exception {
        ArgumentCaptor<ByaiMessage> saved = ArgumentCaptor.forClass(ByaiMessage.class);
        verify(messages).insert(saved.capture());
        ByaiMessage message = saved.getValue();
        assertThat(message.getUsage()).isEqualTo(5);
        assertThat(message.getSessionId()).isEqualTo(200L);
        assertThat(message.getMessageContent()).isEqualTo(content);
        assertThat(message.getMessageId()).isPositive();
        JSONObject metadata = JSON.parseObject(message.getMetadata());
        assertThat(metadata.getString("scene")).isEqualTo("GROUP_CHAT");
        assertThat(metadata.getString("kind")).isEqualTo("SYSTEM_EVENT");
        JSONObject systemEvent = metadata.getJSONObject("systemEvent");
        assertThat(systemEvent.getString("eventType")).isEqualTo(eventType);
        assertThat(systemEvent.getLong("operatorId")).isEqualTo(operatorId);
        assertThat(systemEvent.getLong("memberId")).isEqualTo(memberId);
        assertThat(systemEvent.getString("memberType")).isEqualTo(memberType);
        verify(connection).commit();
        ArgumentCaptor<JSONObject> published = ArgumentCaptor.forClass(JSONObject.class);
        verify(events, times(2)).publish(eq(200L), published.capture(), isNull());
        assertThat(published.getAllValues()).filteredOn(event -> "MESSAGE_CREATED".equals(event.getString("event")))
            .singleElement().satisfies(event -> {
                assertThat(event.getLong("messageId")).isEqualTo(message.getMessageId());
                assertThat(event.getInteger("usage")).isEqualTo(5);
                assertThat(event.getString("content")).isEqualTo(content);
                assertThat(event.getJSONObject("systemEvent")).isEqualTo(systemEvent);
            });
        verifyNoInteractions(coordinator);
        return message;
    }

    private ByaiSessionMember member(Long id, String type, String name) {
        ByaiSessionMember member = new ByaiSessionMember();
        member.setByaiSessionMemberId(id);
        member.setSessionId(200L);
        member.setMemObjId(id);
        member.setMemObjType(type);
        member.setMemName(name);
        member.setUserRole("MEMBER");
        return member;
    }
}
