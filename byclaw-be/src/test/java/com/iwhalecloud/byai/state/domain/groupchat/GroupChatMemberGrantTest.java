package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.RETURNS_DEEP_STUBS;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

import java.sql.Connection;
import java.util.List;
import java.util.Set;
import javax.sql.DataSource;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.application.service.auth.AuthRedisSyncService;
import com.iwhalecloud.byai.manager.application.service.devloop.ProjectApplicationService;
import com.iwhalecloud.byai.manager.domain.auth.service.PrivilegeGrantService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectMemberService;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.mapper.auth.PrivilegeGrantMapper;
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
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.data.redis.core.SetOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** 通过真实 Spring 事务代理验证入群与授权边界，外部数据库连接和缓存使用测试替身。 */
class GroupChatMemberGrantTest {
    private final SessionService sessions = mock(SessionService.class);
    private final SessionMemberService members = mock(SessionMemberService.class);
    private final ProjectMemberService projectMembers = mock(ProjectMemberService.class);
    private final GroupChatAuthorizationService authorization = mock(GroupChatAuthorizationService.class);
    private final GroupChatInvitationService invitations = mock(GroupChatInvitationService.class);
    private final PrivilegeGrantService grants = mock(PrivilegeGrantService.class);
    private final PrivilegeGrantMapper grantMapper = mock(PrivilegeGrantMapper.class);
    private final AuthRedisSyncService cacheSync = mock(AuthRedisSyncService.class);
    private final GroupChatEventPublisher events = mock(GroupChatEventPublisher.class);
    private final ByaiSession group = new ByaiSession();
    private final Connection connection = mock(Connection.class);
    private SetOperations<String, String> redis;
    private Object previousRedis;
    private GroupChatApplicationService service;
    private AuthApplicationService authService;

    @BeforeEach
    void setUp() throws Exception {
        previousRedis = ReflectionTestUtils.getField(RedisUtil.class, "instance");
        StringRedisTemplate template = mock(StringRedisTemplate.class, RETURNS_DEEP_STUBS);
        redis = template.opsForSet();
        RedisUtil redisUtil = new RedisUtil();
        ReflectionTestUtils.setField(redisUtil, "stringRedisTemplate", template);
        ReflectionTestUtils.setField(RedisUtil.class, "instance", redisUtil);
        LoginInfo login = new LoginInfo();
        login.setUserId(10L);
        CurrentUserHolder.setLoginInfo(login);
        group.setSessionId(200L);
        group.setProjectId(100L);
        when(authorization.requireGroup(200L)).thenReturn(group);
        when(invitations.validateForMemberInvitation(200L, "Ab1234CD")).thenReturn(group);
        when(invitations.validatedInviterId(200L, "Ab1234CD")).thenReturn(20L);
        when(members.findSessionMembers(200L, "AGENT", null)).thenReturn(List.of(agent(30L), agent(40L), agent(30L)));
        when(grantMapper.selectList(any())).thenReturn(List.of());
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), "member-grant-test"),
            PrivilegeGrant.class);

        DataSource dataSource = mock(DataSource.class);
        when(dataSource.getConnection()).thenReturn(connection);
        when(connection.getAutoCommit()).thenReturn(true);
        DataSourceTransactionManager manager = new DataSourceTransactionManager(dataSource);
        AuthApplicationService authTarget = new AuthApplicationService();
        ReflectionTestUtils.setField(authTarget, "privilegeGrantService", grants);
        ReflectionTestUtils.setField(authTarget, "privilegeGrantMapper", grantMapper);
        ReflectionTestUtils.setField(authTarget, "authRedisSyncService", cacheSync);
        authService = proxy(authTarget, manager, AuthApplicationService.class);
        GroupChatApplicationService target = new GroupChatApplicationService(sessions, mock(SequenceService.class),
            authorization, members, mock(ProjectApplicationService.class), projectMembers,
            mock(ByaiMessageMapper.class), mock(GroupChatExecutionCoordinator.class), events, mock(SessionExtService.class));
        ReflectionTestUtils.setField(target, "authApplicationService", authService);
        ReflectionTestUtils.setField(target, "invitationService", invitations);
        service = proxy(target, manager, GroupChatApplicationService.class);
    }

    @AfterEach
    void tearDown() {
        ReflectionTestUtils.setField(RedisUtil.class, "instance", previousRedis);
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void adminInvitationGrantsEveryDistinctEmployeeToIncomingUserAndPublishesOnlyAfterCommit() throws Exception {
        doAnswer(invocation -> {
            assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isTrue();
            verifyNoInteractions(redis);
            verifyNoInteractions(cacheSync);
            verify(connection, never()).commit();
            return 1;
        }).when(members).save(any());

        service.invite(200L, "USER", 20L);

        assertGrantTargets(20L, 30L, 40L);
        verify(projectMembers).addMember(100L, 20L, "member");
        verify(connection).commit();
        verify(connection, never()).rollback();
        verify(redis).add("DATASET:AUTHORITY:2_RED_READ_PERSON_20", "DIG_EMPLOYEE_30");
        verify(redis).add("DATASET:AUTHORITY:2_RED_READ_PERSON_20", "DIG_EMPLOYEE_40");
        verify(cacheSync).asyncSyncAuthChangedUsers(Set.of(20L), "FORCE_USE");
        verify(cacheSync).asyncSyncManageAuthChangedUsers(Set.of(20L), "FORCE_USE");
    }

    @Test
    void linkAcceptanceUsesLoggedInJoinerAndSameGrantPath() throws Exception {
        service.acceptInvitation(200L, "Ab1234CD");
        assertGrantTargets(10L, 30L, 40L);
        verify(projectMembers).addMember(100L, 10L, "member");
        verify(connection).commit();
        verify(events, times(2)).publish(any(), any(), any());
    }

    @Test
    void existingProjectMemberStillReceivesEmployeeGrants() {
        when(projectMembers.isMember(100L, 20L)).thenReturn(true);
        service.invite(200L, "USER", 20L);
        assertGrantTargets(20L, 30L, 40L);
        verify(projectMembers, never()).addMember(any(), any(), any());
    }

    @Test
    void groupWithoutProjectStillGrantsEmployees() {
        group.setProjectId(null);
        service.invite(200L, "USER", 20L);
        assertGrantTargets(20L, 30L, 40L);
        verifyNoInteractions(projectMembers);
    }

    @Test
    void emptyEmployeeGroupDoesNotTouchPrivileges() {
        when(members.findSessionMembers(200L, "AGENT", null)).thenReturn(List.of());
        service.invite(200L, "USER", 20L);
        verify(members).save(any());
        verifyNoInteractions(grants, grantMapper, cacheSync);
        verifyNoInteractions(redis);
    }

    @Test
    void agentInvitationGrantsNewEmployeeToEveryDistinctHumanMember() {
        when(members.findSessionMembers(200L, "USER", null))
            .thenReturn(List.of(user(10L), user(20L), user(10L)));

        service.invite(200L, "AGENT", 50L);

        ArgumentCaptor<PrivilegeGrant> saved = ArgumentCaptor.forClass(PrivilegeGrant.class);
        verify(grants, times(2)).save(saved.capture());
        assertThat(saved.getAllValues()).extracting(PrivilegeGrant::getGrantObjId).containsOnly(50L);
        assertThat(saved.getAllValues()).extracting(PrivilegeGrant::getGrantToObjId).containsExactly(10L, 20L);
        assertThat(saved.getAllValues()).allSatisfy(grant -> {
            assertThat(grant.getGrantObjType()).isEqualTo("DIG_EMPLOYEE");
            assertThat(grant.getGrantToObjType()).isEqualTo("USER");
            assertThat(grant.getGrantType()).isEqualTo("FORCE_USE");
            assertThat(grant.getGrantToType()).isEqualTo("RED");
            assertThat(grant.getOperType()).isEqualTo("READ");
            assertThat(grant.getStatusCd()).isEqualTo("A");
        });
        verify(members).save(any());
        verify(projectMembers, never()).addMember(any(), any(), any());
    }

    @Test
    void existingForceUseIsSkippedAndOtherListsAreNeverOverwritten() {
        PrivilegeGrant existing = new PrivilegeGrant();
        existing.setGrantObjId(30L);
        when(grantMapper.selectList(any())).thenAnswer(invocation -> {
            // 去重只读取有效 USER/FORCE_USE/RED 行，其他使用授权和黑名单不参与去重。
            LambdaQueryWrapper<?> query = invocation.getArgument(0);
            assertThat(query.getSqlSegment()).contains("grant_obj_type", "grant_obj_id", "grant_to_obj_type",
                "grant_to_obj_id", "grant_type", "grant_to_type", "oper_type", "status_cd");
            assertThat(query.getParamNameValuePairs().values())
                .contains("DIG_EMPLOYEE", "USER", 20L, 30L, 40L, "FORCE_USE", "RED", "READ", "A")
                .doesNotContain("AVAILABLE_USE", "BLACK");
            return List.of(existing);
        });
        service.invite(200L, "USER", 20L);
        assertGrantTargets(20L, 40L);
        verify(grantMapper).selectList(any());
        verifyNoMoreInteractions(grantMapper, grants);
    }

    @Test
    void repeatedBatchGrantDoesNotInsertAgain() {
        PrivilegeGrant existing = new PrivilegeGrant();
        existing.setGrantObjId(30L);
        when(grantMapper.selectList(any())).thenReturn(List.of(), List.of(existing));
        authService.grantDigitalEmployeesToUser(List.of(30L, 30L), 20L);
        authService.grantDigitalEmployeesToUser(List.of(30L), 20L);
        assertGrantTargets(20L, 30L);
        verify(redis, times(1)).add("DATASET:AUTHORITY:2_RED_READ_PERSON_20", "DIG_EMPLOYEE_30");
        verify(cacheSync, times(1)).asyncSyncAuthChangedUsers(Set.of(20L), "FORCE_USE");
    }

    @Test
    void grantFailureRollsBackWholeInvitationAndDoesNotPublishCache() throws Exception {
        doAnswer(invocation -> {
            PrivilegeGrant grant = invocation.getArgument(0);
            assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isTrue();
            if (grant.getGrantObjId().equals(40L)) {
                throw new IllegalStateException("grant failed");
            }
            return null;
        }).when(grants).save(any());
        assertThatThrownBy(() -> service.invite(200L, "USER", 20L)).hasMessage("grant failed");
        verify(projectMembers).addMember(100L, 20L, "member");
        verify(grants, times(2)).save(any());
        verify(members, never()).save(any());
        assertRollbackWithoutCache();
    }

    @Test
    void laterMemberFailureRollsBackGrantsAndDoesNotPublishCache() throws Exception {
        doThrow(new IllegalStateException("member failed")).when(members).save(any());
        assertThatThrownBy(() -> service.invite(200L, "USER", 20L)).hasMessage("member failed");
        assertGrantTargets(20L, 30L, 40L);
        assertRollbackWithoutCache();
    }

    @Test
    void linkMemberFailureRollsBackGrantsAndDoesNotPublishEvent() throws Exception {
        doThrow(new IllegalStateException("member failed")).when(members).save(any());
        assertThatThrownBy(() -> service.acceptInvitation(200L, "Ab1234CD")).hasMessage("member failed");
        assertGrantTargets(10L, 30L, 40L);
        assertRollbackWithoutCache();
        verifyNoInteractions(events);
    }

    private void assertRollbackWithoutCache() throws Exception {
        verify(connection).rollback();
        verify(connection, never()).commit();
        verifyNoInteractions(redis);
        verifyNoInteractions(cacheSync);
    }

    @Test
    void batchAgentsAreDeduplicatedAndGrantedToAllUsersInOneTransaction() throws Exception {
        when(members.findSessionMembers(200L, "USER", null)).thenReturn(List.of(user(10L), user(20L)));
        assertThat(service.inviteBatch(200L, "AGENT", List.of(50L, 60L, 50L)))
            .extracting(ByaiSessionMember::getMemObjId).containsExactly(50L, 60L);
        verify(sessions).lockById(200L);
        verify(authorization).requireInvite(200L, "AGENT");
        verify(members, times(2)).save(any());
        ArgumentCaptor<PrivilegeGrant> saved = ArgumentCaptor.forClass(PrivilegeGrant.class);
        verify(grants, times(4)).save(saved.capture());
        assertThat(saved.getAllValues()).extracting(PrivilegeGrant::getGrantObjId)
            .containsExactly(50L, 50L, 60L, 60L);
        assertThat(saved.getAllValues()).extracting(PrivilegeGrant::getGrantToObjId)
            .containsExactly(10L, 20L, 10L, 20L);
        verify(connection).commit();
    }

    @Test
    void secondBatchMemberFailureRollsBackFirstMemberAndAllGrants() throws Exception {
        when(members.findSessionMembers(200L, "USER", null)).thenReturn(List.of(user(10L)));
        doAnswer(invocation -> {
            ByaiSessionMember member = invocation.getArgument(0);
            if (member.getMemObjId().equals(60L)) throw new IllegalStateException("second member failed");
            return 1;
        }).when(members).save(any());
        assertThatThrownBy(() -> service.inviteBatch(200L, "AGENT", List.of(50L, 60L)))
            .hasMessage("second member failed");
        verify(members, times(2)).save(any());
        assertRollbackWithoutCache();
        verifyNoInteractions(events);
    }

    @Test
    void batchUsersEachReceiveExistingEmployees() throws Exception {
        service.inviteBatch(200L, "USER", List.of(20L, 21L));
        verify(projectMembers).addMember(100L, 20L, "member");
        verify(projectMembers).addMember(100L, 21L, "member");
        verify(grants, times(4)).save(any());
        verify(connection).commit();
    }

    @Test
    void existingMemberRejectsBatchBeforeAnyWrites() {
        when(members.findSessionMember(200L, "AGENT", 60L)).thenReturn(agent(60L));
        assertThatThrownBy(() -> service.inviteBatch(200L, "AGENT", List.of(50L, 60L)))
            .isInstanceOf(IllegalArgumentException.class);
        verify(members, never()).save(any());
        verifyNoInteractions(grants, events);
    }

    private void assertGrantTargets(Long userId, Long... resourceIds) {
        ArgumentCaptor<PrivilegeGrant> saved = ArgumentCaptor.forClass(PrivilegeGrant.class);
        verify(grants, times(resourceIds.length)).save(saved.capture());
        assertThat(saved.getAllValues()).extracting(PrivilegeGrant::getGrantObjId).containsExactly(resourceIds);
        assertThat(saved.getAllValues()).allSatisfy(grant -> {
            assertThat(grant.getGrantObjType()).isEqualTo("DIG_EMPLOYEE");
            assertThat(grant.getGrantToObjType()).isEqualTo("USER");
            assertThat(grant.getGrantToObjId()).isEqualTo(userId);
            assertThat(grant.getGrantType()).isEqualTo("FORCE_USE");
            assertThat(grant.getGrantToType()).isEqualTo("RED");
            assertThat(grant.getOperType()).isEqualTo("READ");
            assertThat(grant.getStatusCd()).isEqualTo("A");
        });
    }

    private ByaiSessionMember agent(Long resourceId) {
        ByaiSessionMember member = new ByaiSessionMember();
        member.setMemObjType("AGENT");
        member.setMemObjId(resourceId);
        return member;
    }

    private ByaiSessionMember user(Long userId) {
        ByaiSessionMember member = new ByaiSessionMember();
        member.setMemObjType("USER");
        member.setMemObjId(userId);
        return member;
    }

    private <T> T proxy(T target, DataSourceTransactionManager manager, Class<T> type) {
        TransactionInterceptor interceptor = new TransactionInterceptor();
        interceptor.setTransactionManager(manager);
        interceptor.setTransactionAttributeSource(new AnnotationTransactionAttributeSource());
        ProxyFactory factory = new ProxyFactory(target);
        factory.setProxyTargetClass(true);
        factory.addAdvice(interceptor);
        return type.cast(factory.getProxy());
    }
}
