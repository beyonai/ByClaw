package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.sql.Connection;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import javax.sql.DataSource;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectMemberService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.enterprise.EnterpriseInfo;
import com.iwhalecloud.byai.manager.entity.message.MessageShareLink;
import com.iwhalecloud.byai.manager.entity.session.*;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.enterprise.EnterpriseInfoMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatExecutionMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.manager.mapper.message.MessageShareLinkMapper;
import com.iwhalecloud.byai.state.domain.groupchat.application.*;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatApplicationService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatSettingsRequest;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import com.iwhalecloud.byai.state.domain.session.service.*;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.junit.jupiter.api.*;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;
import org.springframework.transaction.support.TransactionSynchronizationManager;

class GroupChatInvitationTokenTest {
    private final MessageShareLinkMapper links = mock(MessageShareLinkMapper.class);
    private final Map<Long, MessageShareLink> records = new HashMap<>();
    private final SessionService sessions = mock(SessionService.class);
    private final SessionExtService extensions = mock(SessionExtService.class);
    private final SessionMemberService members = mock(SessionMemberService.class);
    private final UserService users = mock(UserService.class);
    private final SequenceService sequence = mock(SequenceService.class);
    private final ProjectMemberService projectMembers = mock(ProjectMemberService.class);
    private final ByaiMessageMapper messages = mock(ByaiMessageMapper.class);
    private final GroupChatEventPublisher events = mock(GroupChatEventPublisher.class);
    private final EnterpriseInfoMapper enterprises = mock(EnterpriseInfoMapper.class);
    private final GroupChatAuthorizationService auth = new GroupChatAuthorizationService(sessions, members, extensions);
    private final GroupChatInvitationService service = new GroupChatInvitationService(
        links, sessions, extensions, members, auth, users, enterprises, mock(SsResourceService.class));
    private final GroupChatApplicationService application =
        new GroupChatApplicationService(
            sessions, sequence, auth, members, null, projectMembers, messages, null, events, extensions);
    private ByaiSession group;
    private ByaiSessionMember owner;

    @BeforeEach void setup() {
        ReflectionTestUtils.setField(application, "invitationService", service);
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

    @Test void memberPermissionsAreIndependentAndDefaultToDisabled() {
        owner.setUserRole("MEMBER");
        assertThatThrownBy(() -> auth.requireInvite(20L, "AGENT")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.create(20L)).isInstanceOf(IllegalArgumentException.class);
        ByaiSessionExt agent = new ByaiSessionExt();
        agent.setExtParamValue("true");
        when(extensions.findOneByExtParamCode(20L, GroupChatAuthorizationService.MEMBER_ADD_AGENT)).thenReturn(agent);
        assertThatCode(() -> auth.requireInvite(20L, "AGENT")).doesNotThrowAnyException();
        assertThatThrownBy(() -> auth.requireInvite(20L, "USER")).isInstanceOf(IllegalArgumentException.class);
        ByaiSessionExt user = new ByaiSessionExt();
        user.setExtParamValue("true");
        when(extensions.findOneByExtParamCode(20L, GroupChatAuthorizationService.MEMBER_INVITE_USER)).thenReturn(user);
        String token = service.create(20L).getToken();
        assertThat(service.preview(token).getGroupName()).isEqualTo("协作组");
        user.setExtParamValue("false");
        assertThatThrownBy(() -> service.preview(token)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.create(20L)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test void administratorsBypassBothMemberPermissionsButNonMembersCannot() {
        for (String role : List.of("OWNER", "ADMIN")) {
            owner.setUserRole(role);
            assertThatCode(() -> auth.requireInvite(20L, "USER")).doesNotThrowAnyException();
            assertThatCode(() -> auth.requireInvite(20L, "AGENT")).doesNotThrowAnyException();
        }
        when(members.findSessionMember(20L, "USER", 10L)).thenReturn(null);
        assertThatThrownBy(() -> auth.requireInvite(20L, "USER")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> auth.requireInvite(20L, "AGENT")).isInstanceOf(IllegalArgumentException.class);
    }

    @Test void settingsPersistEachPermissionWithoutChangingOtherSettings() {
        var settings = new GroupChatSettingsService(sessions, extensions, members, auth, sequence,
            mock(ByaiGroupChatTaskMapper.class),
            mock(ByaiGroupChatExecutionMapper.class), events);
        Map<String, ByaiSessionExt> stored = new HashMap<>();
        when(extensions.findOneByExtParamCode(eq(20L), anyString()))
            .thenAnswer(call -> stored.get(call.getArgument(1)));
        doAnswer(call -> {
            ByaiSessionExt ext = call.getArgument(0);
            stored.put(ext.getExtParamCode(), ext);
            return null;
        }).when(extensions).save(any());
        assertThat(settings.settings(20L).isAllowMemberAddAgent()).isFalse();
        assertThat(settings.settings(20L).isAllowMemberInviteUser()).isFalse();
        TransactionSynchronizationManager.initSynchronization();
        try {
            var request = new GroupChatSettingsRequest();
            request.setAllowMemberAddAgent(true);
            settings.updateSettings(20L, request);
            assertThat(settings.settings(20L).isAllowMemberAddAgent()).isTrue();
            assertThat(settings.settings(20L).isAllowMemberInviteUser()).isFalse();
            request = new GroupChatSettingsRequest();
            request.setAllowMemberInviteUser(true);
            settings.updateSettings(20L, request);
            assertThat(settings.settings(20L).isAllowMemberAddAgent()).isTrue();
            assertThat(settings.settings(20L).isAllowMemberInviteUser()).isTrue();
            assertThat(settings.settings(20L).isAllowJoinByLink()).isTrue();
            request.setAllowMemberInviteUser(false);
            settings.updateSettings(20L, request);
            assertThat(settings.settings(20L).isAllowMemberInviteUser()).isFalse();
            owner.setUserRole("MEMBER");
            var memberRequest = request;
            assertThatThrownBy(() -> settings.updateSettings(20L, memberRequest)).isInstanceOf(IllegalArgumentException.class);
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

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
    @Test void reusedLinkRetainsOriginalInviterWhenAnotherAdministratorRenewsIt() {
        String token = service.create(20L).getToken();
        ByaiSessionMember administrator = new ByaiSessionMember();
        administrator.setMemObjId(11L);
        administrator.setMemObjType("USER");
        administrator.setUserRole("ADMIN");
        when(members.findSessionMember(20L, "USER", 11L)).thenReturn(administrator);
        Users administratorUser = new Users();
        administratorUser.setState("A");
        when(users.findById(11L)).thenReturn(administratorUser);
        CurrentUserHolder.getLoginInfo().setUserId(11L);
        assertThat(service.create(20L).getToken()).isEqualTo(token);
        // 链接续期不会把后来的管理员写成最初的邀请人。
        assertThat(service.validatedInviterId(20L, token)).isEqualTo(10L);
        assertThat(records.get(20L).getCreatorId()).isEqualTo(10L);
    }

    @Test void inviterLookupRejectsForeignGroupMalformedAndExpiredTokens() {
        String token = service.create(20L).getToken();
        assertThatThrownBy(() -> service.validatedInviterId(21L, token)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.validatedInviterId(20L, "invalid!")).isInstanceOf(IllegalArgumentException.class);
        records.get(20L).setExpireTime(LocalDateTime.now().minusSeconds(1));
        assertThatThrownBy(() -> service.validatedInviterId(20L, token)).isInstanceOf(IllegalArgumentException.class);
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
            enterprises, mock(SsResourceService.class));
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
        TransactionSynchronizationManager.initSynchronization();
        try {
            var joined = application.acceptInvitation(20L, token);
            assertThat(joined.getSessionId()).isEqualTo(20L);
            assertThat(joined.getMemObjId()).isEqualTo(11L);
            assertThat(joined.getUserRole()).isEqualTo("MEMBER");
            assertThat(joined.getLastReadMessageId()).isEqualTo(50L);
            verify(projectMembers).addMember(30L, 11L, "member");
            verifyNoInteractions(events);
            var callbacks = TransactionSynchronizationManager.getSynchronizations();
            assertThat(callbacks).hasSize(2);
            callbacks.forEach(callback -> callback.afterCommit());
            verify(events, times(2)).publish(eq(20L), any(), isNull());
            when(members.findSessionMember(20L, "USER", 11L)).thenReturn(joined);
            assertThat(application.acceptInvitation(20L, token)).isSameAs(joined);
            verify(members, times(1)).save(any());
            verify(projectMembers, times(1)).addMember(any(), any(), any());
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    @Test void tokenJoinRollsBackProjectMembershipWhenGroupInsertFails() throws Exception {
        var token = service.create(20L).getToken();
        CurrentUserHolder.getLoginInfo().setUserId(11L);
        when(users.findById(11L)).thenReturn(new Users());
        group.setProjectId(30L);
        var dataSource = mock(DataSource.class);
        var connection = mock(Connection.class);
        when(dataSource.getConnection()).thenReturn(connection);
        when(connection.getAutoCommit()).thenReturn(true);
        var interceptor = new TransactionInterceptor();
        interceptor.setTransactionManager(new DataSourceTransactionManager(dataSource));
        interceptor.setTransactionAttributeSource(new AnnotationTransactionAttributeSource());
        var factory = new ProxyFactory(application);
        factory.setProxyTargetClass(true);
        factory.addAdvice(interceptor);
        when(members.save(any())).thenThrow(new IllegalStateException("group insert failed"));
        var transactionalService = (GroupChatApplicationService) factory.getProxy();
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
        var enterprise = new EnterpriseInfo();
        enterprise.setComAcctName("示例企业");
        when(enterprises.selectById(3L)).thenReturn(enterprise);
        var token = service.create(20L).getToken();
        CurrentUserHolder.clearLoginInfo();
        var preview = JSON.parseObject(JSON.toJSONString(service.preview(token)));
        assertThat(preview.getString("enterpriseName")).isEqualTo("示例企业");
        var displayMembers = preview.getJSONArray("memberPreviews");
        assertThat(displayMembers).isNotNull().hasSize(4);
        assertThat(displayMembers.getJSONObject(0).getString("displayName")).isEqualTo("邀请人");
        assertThat(displayMembers.getJSONObject(0).keySet()).doesNotContain("memObjId", "userId", "userRole");
    }
}
