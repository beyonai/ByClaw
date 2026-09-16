package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;
import java.util.List;
import org.junit.jupiter.api.*;
import com.iwhalecloud.byai.manager.entity.message.MessageShareLink;
import com.iwhalecloud.byai.manager.mapper.message.MessageShareLinkMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.entity.session.*;
import com.iwhalecloud.byai.manager.mapper.enterprise.EnterpriseInfoMapper;
import com.iwhalecloud.byai.state.domain.groupchat.application.*;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.session.service.*;

class GroupChatInvitationTokenTest {
    private final MessageShareLinkMapper links = mock(MessageShareLinkMapper.class);
    private final Map<Long, MessageShareLink> records = new HashMap<>();
    private final SessionService sessions = mock(SessionService.class);
    private final SessionExtService extensions = mock(SessionExtService.class);
    private final SessionMemberService members = mock(SessionMemberService.class);
    private final UserService users = mock(UserService.class);
    private final com.iwhalecloud.byai.state.domain.sys.service.SequenceService sequence = mock(com.iwhalecloud.byai.state.domain.sys.service.SequenceService.class);
    private final com.iwhalecloud.byai.manager.domain.devloop.service.ProjectMemberService projectMembers = mock(com.iwhalecloud.byai.manager.domain.devloop.service.ProjectMemberService.class);
    private final com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper messages = mock(com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper.class);
    private final com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher events = mock(com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher.class);
    private final EnterpriseInfoMapper enterprises = mock(EnterpriseInfoMapper.class);
    private final GroupChatAuthorizationService auth = new GroupChatAuthorizationService(sessions, members);
    private final GroupChatInvitationService service = new GroupChatInvitationService(
        links, sessions, extensions, members, auth, users, enterprises, mock(com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService.class));
    private final com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatApplicationService application =
        new com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatApplicationService(
            sessions, sequence, auth, members, null, projectMembers, messages, null, events, extensions);
    private ByaiSession group;
    private ByaiSessionMember owner;

    @BeforeEach void setup() {
        org.springframework.test.util.ReflectionTestUtils.setField(application, "invitationService", service);
        LoginInfo login = new LoginInfo();
        login.setUserId(10L);
        login.setEnterpriseId(3L);
        CurrentUserHolder.setLoginInfo(login);
        group = new ByaiSession();
        group.setSessionId(20L);
        group.setSessionType("hs_as");
        group.setSessionName("协作组");
        group.setEnterpriseId(3L);
        when(sessions.findById(20L)).thenReturn(group);
        owner = new ByaiSessionMember();
        owner.setMemObjId(10L);
        owner.setMemObjType("USER");
        owner.setUserRole("OWNER");
        owner.setMemName("邀请人");
        when(members.findSessionMember(20L, "USER", 10L)).thenReturn(owner);
        when(members.findOrderedGroupMembers(20L)).thenReturn(List.of(owner));
        Users user = new Users();
        user.setUserName("邀请人");
        user.setState("A");
        when(users.findById(10L)).thenReturn(user);
        when(links.selectInvitationBySessionId(anyLong())).thenAnswer(call -> records.get(call.getArgument(0)));
        when(links.selectInvitationByToken(anyString())).thenAnswer(call -> records.values().stream()
            .filter(record -> record.getLinkToken().equals(call.getArgument(0))).findFirst().orElse(null));
        when(links.insert(any(MessageShareLink.class))).thenAnswer(call -> {
            MessageShareLink record = call.getArgument(0);
            assertThat(records.putIfAbsent(record.getLinkId(), record)).isNull();
            return 1;
        });
        when(links.updateInvitation(any())).thenAnswer(call -> {
            MessageShareLink record = call.getArgument(0);
            assertThat(records.replace(record.getLinkId(), record)).isNotNull();
            return 1;
        });
    }
    @AfterEach void cleanup() { CurrentUserHolder.clearLoginInfo(); }

    @Test void rejectsSymbolsInToken() {
        assertThatThrownBy(() -> service.preview("Ab12_-CD")).isInstanceOf(IllegalArgumentException.class);
        verifyNoInteractions(links);
    }

    @Test void storesOriginalTokenInShareTableAndReusesIt() {
        var result = service.create(20L);
        assertThat(result.getToken()).matches("[A-Za-z0-9]{8}");
        assertThat(records.get(20L).getLinkToken()).isEqualTo(result.getToken());
        assertThat(records.get(20L).getLinkType()).isEqualTo("GROUP_INVITATION");
        assertThat(records.get(20L).getCreatorId()).isEqualTo(10L);
        assertThat(records.get(20L).getComAcctId()).isEqualTo(3L);
        var repeated = service.create(20L);
        assertThat(repeated.getToken()).isEqualTo(result.getToken());
        assertThat(repeated.getExpiresAt()).isGreaterThanOrEqualTo(result.getExpiresAt());
    }
    @Test void renewsTheSameSessionTokenFromTheCurrentTime() {
        var first = service.create(20L);
        records.get(20L).setExpireTime(LocalDateTime.now().plusMinutes(1));
        var renewed = service.create(20L);
        assertThat(renewed.getToken()).isEqualTo(first.getToken());
        assertThat(renewed.getExpiresAt()).isGreaterThan(System.currentTimeMillis() + Duration.ofDays(6).toMillis());
        assertThat(records.size()).isEqualTo(1);
        verify(sessions, times(2)).lockById(20L);
    }

    @Test void expiredOrMissingRecordsCreateANewToken() {
        var first = service.create(20L);
        records.get(20L).setExpireTime(LocalDateTime.now().minusDays(1));
        var second = service.create(20L);
        assertThat(second.getToken()).isNotEqualTo(first.getToken());
        assertThatThrownBy(() -> service.preview(first.getToken())).isInstanceOf(IllegalArgumentException.class);
        assertThat(records).hasSize(1);
        records.clear();
        assertThat(service.create(20L).getToken()).isNotEqualTo(second.getToken());
    }

    @Test void anotherSessionGetsItsOwnToken() {
        var first = service.create(20L);
        ByaiSession other = new ByaiSession();
        other.setSessionId(21L);
        other.setSessionType("hs_as");
        other.setEnterpriseId(3L);
        when(sessions.findById(21L)).thenReturn(other);
        when(members.findSessionMember(21L, "USER", 10L)).thenReturn(owner);
        var second = service.create(21L);
        assertThat(second.getToken()).isNotEqualTo(first.getToken());
        assertThat(service.create(20L).getToken()).isEqualTo(first.getToken());
    }

    @Test void aNewServiceInstanceReusesPersistedInvitation() {
        var first = service.create(20L);
        var restarted = new GroupChatInvitationService(links, sessions, extensions, members, auth, users,
            enterprises, mock(com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService.class));
        assertThat(restarted.create(20L).getToken()).isEqualTo(first.getToken());
        assertThat(restarted.preview(first.getToken()).getGroupName()).isEqualTo("协作组");
        verify(links, times(1)).insert(any(MessageShareLink.class));
    }

    @Test void revokedInvitationIsRejectedAndReplacedInPlace() {
        var first = service.create(20L);
        records.get(20L).setStatus("REVOKED");
        assertThatThrownBy(() -> service.preview(first.getToken())).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> application.acceptInvitation(20L, first.getToken()))
            .isInstanceOf(IllegalArgumentException.class);
        var replacement = service.create(20L);
        assertThat(replacement.getToken()).isNotEqualTo(first.getToken());
        assertThat(records).hasSize(1);
        assertThatThrownBy(() -> service.preview(first.getToken())).isInstanceOf(IllegalArgumentException.class);
    }

    @Test void failedPersistenceDoesNotReturnAnInvitation() {
        when(links.insert(any(MessageShareLink.class))).thenReturn(0);
        assertThatThrownBy(() -> service.create(20L)).isInstanceOf(IllegalStateException.class);
        assertThat(records).isEmpty();
    }

    @Test void anonymousPreviewReturnsDisplayData() {
        var token = service.create(20L).getToken();
        CurrentUserHolder.clearLoginInfo();
        var preview = service.preview(token);
        assertThat(preview.getGroupName()).isEqualTo("协作组");
        assertThat(preview.getInviterName()).isEqualTo("邀请人");
        assertThat(preview.getMemberCount()).isEqualTo(1);
        assertThat(preview.isAlreadyMember()).isFalse();
        assertThatThrownBy(() -> application.acceptInvitation(20L, token)).isInstanceOf(IllegalArgumentException.class);
    }
    @Test void invalidExpiredAndRemovedTokensAreRejected() {
        assertThatThrownBy(() -> service.preview("20")).isInstanceOf(IllegalArgumentException.class);
        var token = service.create(20L).getToken();
        records.get(20L).setExpireTime(LocalDateTime.now().minusDays(1));
        assertThatThrownBy(() -> service.preview(token)).isInstanceOf(IllegalArgumentException.class);
        records.clear();
        assertThatThrownBy(() -> application.acceptInvitation(20L, token)).isInstanceOf(IllegalArgumentException.class);
        verify(members, never()).save(any());
    }
    @Test void lostInviterRoleRevokesBothPreviewAndJoin() {
        var token = service.create(20L).getToken();
        owner.setUserRole("MEMBER");
        assertThatThrownBy(() -> service.preview(token)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> application.acceptInvitation(20L, token)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.create(20L)).isInstanceOf(IllegalArgumentException.class);
        verify(members, never()).save(any());
    }
    @Test void disabledLinkAndDissolvedGroupRevokeToken() {
        var token = service.create(20L).getToken();
        ByaiSessionExt ext = new ByaiSessionExt();
        ext.setExtParamValue("false");
        when(extensions.findOneByExtParamCode(20L, "group_join_link_enabled")).thenReturn(ext);
        assertThatThrownBy(() -> application.acceptInvitation(20L, token)).isInstanceOf(IllegalArgumentException.class);
        when(extensions.findOneByExtParamCode(20L, "group_join_link_enabled")).thenReturn(null);
        group.setState("GROUP_DISSOLVED");
        assertThatThrownBy(() -> service.preview(token)).isInstanceOf(IllegalArgumentException.class);
        verify(members, never()).save(any());
    }
    @Test void crossEnterpriseCannotJoin() {
        var token = service.create(20L).getToken();
        CurrentUserHolder.getLoginInfo().setEnterpriseId(4L);
        assertThatThrownBy(() -> application.acceptInvitation(20L, token)).isInstanceOf(IllegalArgumentException.class);
        verify(members, never()).save(any());
    }
    @Test void successfulJoinUsesServerBoundGroupAndIsIdempotent() {
        var token = service.create(20L).getToken();
        CurrentUserHolder.getLoginInfo().setUserId(11L);
        when(users.findById(11L)).thenReturn(new Users());
        group.setProjectId(30L);
        when(sequence.nextVal()).thenReturn(99L);
        when(messages.selectLatestMessageId(20L)).thenReturn(50L);
        org.springframework.transaction.support.TransactionSynchronizationManager.initSynchronization();
        try {
            var joined = application.acceptInvitation(20L, token);
            assertThat(joined.getSessionId()).isEqualTo(20L);
            assertThat(joined.getMemObjId()).isEqualTo(11L);
            assertThat(joined.getUserRole()).isEqualTo("MEMBER");
            assertThat(joined.getLastReadMessageId()).isEqualTo(50L);
            verify(projectMembers).addMember(30L, 11L, "member");
            verifyNoInteractions(events);
            var callbacks = org.springframework.transaction.support.TransactionSynchronizationManager.getSynchronizations();
            assertThat(callbacks).hasSize(1);
            callbacks.forEach(callback -> callback.afterCommit());
            verify(events).publish(eq(20L), any(), isNull());
            when(members.findSessionMember(20L, "USER", 11L)).thenReturn(joined);
            assertThat(application.acceptInvitation(20L, token)).isSameAs(joined);
            verify(members, times(1)).save(any());
            verify(projectMembers, times(1)).addMember(any(), any(), any());
        } finally {
            org.springframework.transaction.support.TransactionSynchronizationManager.clearSynchronization();
        }
    }

    @Test void tokenJoinRollsBackProjectMembershipWhenGroupInsertFails() throws Exception {
        var token = service.create(20L).getToken();
        CurrentUserHolder.getLoginInfo().setUserId(11L);
        when(users.findById(11L)).thenReturn(new Users());
        group.setProjectId(30L);
        var dataSource = mock(javax.sql.DataSource.class);
        var connection = mock(java.sql.Connection.class);
        when(dataSource.getConnection()).thenReturn(connection);
        when(connection.getAutoCommit()).thenReturn(true);
        var interceptor = new org.springframework.transaction.interceptor.TransactionInterceptor();
        interceptor.setTransactionManager(new org.springframework.jdbc.datasource.DataSourceTransactionManager(dataSource));
        interceptor.setTransactionAttributeSource(new org.springframework.transaction.annotation.AnnotationTransactionAttributeSource());
        var factory = new org.springframework.aop.framework.ProxyFactory(application);
        factory.setProxyTargetClass(true);
        factory.addAdvice(interceptor);
        when(members.save(any())).thenThrow(new IllegalStateException("group insert failed"));
        var transactionalService = (com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatApplicationService) factory.getProxy();
        assertThatThrownBy(() -> transactionalService.acceptInvitation(20L, token)).hasMessage("group insert failed");
        verify(connection).rollback();
        verify(connection, never()).commit();
        verifyNoInteractions(events);
    }

    @Test void tokenCannotBeUsedForAnotherGroup() {
        var token = service.create(20L).getToken();
        assertThatThrownBy(() -> application.acceptInvitation(21L, token)).isInstanceOf(IllegalArgumentException.class);
        verify(members, never()).save(any());
    }

    @Test void previewReturnsAtMostFourDisplayOnlyMembersAndEnterprise() {
        owner.setMemObjType("USER");
        owner.setMemObjId(10L);
        when(members.findOrderedGroupMembers(20L)).thenReturn(List.of(owner, owner, owner, owner, owner));
        var enterprise = new com.iwhalecloud.byai.manager.entity.enterprise.EnterpriseInfo();
        enterprise.setComAcctName("示例企业");
        when(enterprises.selectById(3L)).thenReturn(enterprise);
        var token = service.create(20L).getToken();
        CurrentUserHolder.clearLoginInfo();
        var preview = com.alibaba.fastjson.JSON.parseObject(com.alibaba.fastjson.JSON.toJSONString(service.preview(token)));
        assertThat(preview.getString("enterpriseName")).isEqualTo("示例企业");
        var displayMembers = preview.getJSONArray("memberPreviews");
        assertThat(displayMembers).isNotNull().hasSize(4);
        assertThat(displayMembers.getJSONObject(0).getString("displayName")).isEqualTo("邀请人");
        assertThat(displayMembers.getJSONObject(0).keySet()).doesNotContain("memObjId", "userId", "userRole");
    }
}
