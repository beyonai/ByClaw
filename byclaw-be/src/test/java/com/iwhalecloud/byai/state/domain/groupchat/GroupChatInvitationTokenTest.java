package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.List;
import org.junit.jupiter.api.*;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
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
    private final StringRedisTemplate redis = mock(StringRedisTemplate.class);
    private final ValueOperations<String, String> values = mock(ValueOperations.class);
    private final Map<String, String> cache = new HashMap<>();
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
        redis, sessions, extensions, members, auth, users, enterprises, sequence, projectMembers, messages, events, mock(com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService.class));
    private ByaiSession group;
    private ByaiSessionMember owner;

    @BeforeEach void setup() {
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
        when(redis.opsForValue()).thenReturn(values);
        when(values.get(anyString())).thenAnswer(call -> cache.get(call.getArgument(0)));
        when(values.setIfAbsent(anyString(), anyString(), any(Duration.class))).thenAnswer(call -> {
            assertThat((Duration) call.getArgument(2)).isEqualTo(Duration.ofDays(7));
            return cache.putIfAbsent(call.getArgument(0), call.getArgument(1)) == null;
        });
    }
    @AfterEach void cleanup() { CurrentUserHolder.clearLoginInfo(); }

    @Test void createsOpaqueTokensAndStoresOnlyDigests() {
        var result = service.create(20L);
        assertThat(result.getToken()).matches("[A-Za-z0-9_-]{43}");
        assertThat(cache.toString()).doesNotContain(result.getToken());
        assertThat(service.create(20L).getToken()).isNotEqualTo(result.getToken());
    }
    @Test void anonymousPreviewReturnsDisplayData() {
        var token = service.create(20L).getToken();
        CurrentUserHolder.clearLoginInfo();
        var preview = service.preview(token);
        assertThat(preview.getGroupName()).isEqualTo("协作组");
        assertThat(preview.getInviterName()).isEqualTo("邀请人");
        assertThat(preview.getMemberCount()).isEqualTo(1);
        assertThat(preview.isAlreadyMember()).isFalse();
        assertThatThrownBy(() -> service.join(token)).isInstanceOf(IllegalArgumentException.class);
    }
    @Test void invalidExpiredAndRemovedTokensAreRejected() {
        assertThatThrownBy(() -> service.preview("20")).isInstanceOf(IllegalArgumentException.class);
        var token = service.create(20L).getToken();
        cache.replaceAll((key, value) -> value.replaceAll("\"expiresAt\":\\d+", "\"expiresAt\":1"));
        assertThatThrownBy(() -> service.preview(token)).isInstanceOf(IllegalArgumentException.class);
        cache.clear();
        assertThatThrownBy(() -> service.join(token)).isInstanceOf(IllegalArgumentException.class);
        verify(members, never()).save(any());
    }
    @Test void lostInviterRoleRevokesBothPreviewAndJoin() {
        var token = service.create(20L).getToken();
        owner.setUserRole("MEMBER");
        assertThatThrownBy(() -> service.preview(token)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.join(token)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.create(20L)).isInstanceOf(IllegalArgumentException.class);
        verify(members, never()).save(any());
    }
    @Test void disabledLinkAndDissolvedGroupRevokeToken() {
        var token = service.create(20L).getToken();
        ByaiSessionExt ext = new ByaiSessionExt();
        ext.setExtParamValue("false");
        when(extensions.findOneByExtParamCode(20L, "group_join_link_enabled")).thenReturn(ext);
        assertThatThrownBy(() -> service.join(token)).isInstanceOf(IllegalArgumentException.class);
        when(extensions.findOneByExtParamCode(20L, "group_join_link_enabled")).thenReturn(null);
        group.setState("GROUP_DISSOLVED");
        assertThatThrownBy(() -> service.preview(token)).isInstanceOf(IllegalArgumentException.class);
        verify(members, never()).save(any());
    }
    @Test void crossEnterpriseCannotJoin() {
        var token = service.create(20L).getToken();
        CurrentUserHolder.getLoginInfo().setEnterpriseId(4L);
        assertThatThrownBy(() -> service.join(token)).isInstanceOf(IllegalArgumentException.class);
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
            var joined = service.join(token);
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
            assertThat(service.join(token)).isSameAs(joined);
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
        var factory = new org.springframework.aop.framework.ProxyFactory(service);
        factory.setProxyTargetClass(true);
        factory.addAdvice(interceptor);
        when(members.save(any())).thenThrow(new IllegalStateException("group insert failed"));
        var transactionalService = (GroupChatInvitationService) factory.getProxy();
        assertThatThrownBy(() -> transactionalService.join(token)).hasMessage("group insert failed");
        verify(connection).rollback();
        verify(connection, never()).commit();
        verifyNoInteractions(events);
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
