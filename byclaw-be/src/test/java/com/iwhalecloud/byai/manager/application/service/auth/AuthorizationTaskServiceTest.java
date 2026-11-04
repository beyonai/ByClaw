package com.iwhalecloud.byai.manager.application.service.auth;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.MybatisSqlSessionFactoryBuilder;
import com.github.pagehelper.PageInterceptor;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.auth.AuthorizationTask;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.auth.AuthorizationTaskMapper;
import com.iwhalecloud.byai.manager.mapper.auth.PrivilegeGrantMapper;
import com.iwhalecloud.byai.manager.qo.auth.AuthorizationTaskQo;
import com.iwhalecloud.byai.manager.qo.auth.ResourceMemberSettingQo;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.junit.jupiter.api.*;
import org.mybatis.spring.SqlSessionTemplate;
import org.mybatis.spring.transaction.SpringManagedTransactionFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.test.util.ReflectionTestUtils;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

/** Actual task table, mapper SQL and Spring transactions; external auth/cache calls are controllable failure points. */
class AuthorizationTaskServiceTest {
    private AuthorizationTaskService service;
    private AuthorizationTaskMapper tasks;
    private JdbcTemplate jdbc;
    private AuthApplicationService auth;
    private AuthRedisSyncService cache;
    private DataSourceTransactionManager transactions;
    private LoginInfo actor;

    @BeforeEach void setup() throws Exception {
        var source = new UnpooledDataSource("org.h2.Driver", "jdbc:h2:mem:auth_" + UUID.randomUUID() + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1", "sa", "");
        jdbc = new JdbcTemplate(source);
        jdbc.execute("CREATE TABLE au_privilege_grant (grant_obj_id bigint, grant_obj_type varchar(32), status_cd varchar(8), grant_type varchar(32), grant_to_obj_type varchar(32), grant_to_obj_id bigint)");
        jdbc.execute("CREATE SCHEMA byai");
        jdbc.execute("CREATE TABLE byai.byai_resource_sync_job (sync_job_id BIGINT PRIMARY KEY, resource_id BIGINT, sync_revision BIGINT)");
        String ddl = Files.readString(Path.of("../deploy/migrations/versions/V0.5.2.1/V0.5.2.1__ddl.sql")).replace("byai.byai_authorization_task", "byai_authorization_task").replace("byai.au_privilege_grant", "au_privilege_grant");
        for (String statement : ddl.split(";")) if (!statement.isBlank()) jdbc.execute(statement);
        jdbc.execute("CREATE TABLE test_grants (resource_id bigint, user_id bigint)");
        var config = new MybatisConfiguration(new Environment("test", new SpringManagedTransactionFactory(), source));
        config.setMapUnderscoreToCamelCase(true);
        var pagination = new PageInterceptor();
        var properties = new Properties(); properties.setProperty("helperDialect", "h2"); pagination.setProperties(properties);
        config.addInterceptor(pagination);
        config.addMapper(AuthorizationTaskMapper.class);
        tasks = new SqlSessionTemplate(new MybatisSqlSessionFactoryBuilder().build(config)).getMapper(AuthorizationTaskMapper.class);
        transactions = new DataSourceTransactionManager(source);
        auth = mock(AuthApplicationService.class);
        cache = mock(AuthRedisSyncService.class);
        var users = mock(UserService.class);
        var logins = mock(LoginApplicationService.class);
        Users user = new Users(); user.setUserId(42L); user.setState("A");
        when(users.findById(42L)).thenReturn(user);
        actor = new LoginInfo(); actor.setUserId(42L); actor.setEnterpriseId(1L);
        when(logins.getLoginInfo(user)).thenReturn(actor);
        CurrentUserHolder.setLoginInfo(actor);
        service = new AuthorizationTaskService();
        ReflectionTestUtils.setField(service, "tasks", tasks);
        ReflectionTestUtils.setField(service, "auth", auth);
        ReflectionTestUtils.setField(service, "redis", cache);
        ReflectionTestUtils.setField(service, "users", users);
        ReflectionTestUtils.setField(service, "logins", logins);
        ReflectionTestUtils.setField(service, "transactions", transactions);
        ReflectionTestUtils.setField(service, "grants", mock(PrivilegeGrantMapper.class));
        ReflectionTestUtils.setField(service, "subjects", mock(com.iwhalecloud.byai.manager.mapper.auth.AuthorizationSubjectMapper.class));
        doAnswer(call -> {
            jdbc.update("INSERT INTO test_grants VALUES (13, 100)");
            AuthorizationCommitBatch.current(auth, cache).refreshUsers(Set.of(100L, 101L), "FORCE_USE");
            return null;
        }).when(auth).setResourceUsers(any());
    }

    @AfterEach void cleanup() { service.shutdown(); CurrentUserHolder.clearLoginInfo(); }

    AuthorizationTaskQo request(String id) {
        AuthorizationTaskQo request = new AuthorizationTaskQo();
        request.setRequestId(id); request.setOperation("USE");
        ResourceMemberSettingQo setting = new ResourceMemberSettingQo(); setting.setResourceId(13L);
        setting.setRedList(List.of()); setting.setBlackList(List.of()); request.setSetting(setting);
        return request;
    }

    @Test void idempotentSubmissionHasOneTaskAndResourceConcurrencyIsRejected() {
        var first = service.submit(request("request_0001"));
        assertThat(service.submit(request("request_0001")).getTaskId()).isEqualTo(first.getTaskId());
        assertThatThrownBy(() -> service.submit(request("request_0002"))).isInstanceOf(BaseException.class);
        var changed = request("request_0001"); changed.setOperation("MANAGE");
        assertThatThrownBy(() -> service.submit(changed)).isInstanceOf(BaseException.class);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM byai_authorization_task", Integer.class)).isEqualTo(1);
        verify(auth, never()).setResourceUsers(any());
    }

    @Test void taskOwnershipIsBoundToBothTenantAndOperator() {
        String id = service.submit(request("request_0001")).getTaskId();
        actor.setUserId(43L);
        assertThatThrownBy(() -> service.get(id)).isInstanceOf(BaseException.class);
        assertThat(service.latest(13L)).isEmpty();
        actor.setUserId(42L); actor.setEnterpriseId(2L);
        assertThatThrownBy(() -> service.retry(id)).isInstanceOf(BaseException.class);
    }

    @Test void committedOutboxRetriesAfterRestartWithoutReapplyingData() {
        String id = service.submit(request("request_0001")).getTaskId();
        doThrow(new IllegalStateException("cache unavailable")).when(cache).syncUserNow(anyLong());
        try (var redis = mockStatic(RedisUtil.class)) {
            service.runNext();
            AuthorizationTask failed = service.get(id);
            assertThat(failed.getStatus()).isEqualTo("RETRYING");
            assertThat(failed.getDataApplied()).isEqualTo(1);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM test_grants", Integer.class)).isEqualTo(1);
            verify(cache, never()).asyncSyncAuthChangedUsers(any(), any());
            doNothing().when(cache).syncUserNow(anyLong());
            jdbc.update("UPDATE byai_authorization_task SET retry_at=0 WHERE task_id=?", id);
            // No worker-local state is needed to resume the committed outbox.
            service.runNext();
            assertThat(service.get(id).getStatus()).isEqualTo("SUCCEEDED");
            assertThat(service.get(id).getProgress()).isEqualTo(100);
            assertThat(service.get(id).getCompletedUsers()).isEqualTo(2);
            verify(auth, times(1)).setResourceUsers(any());
            assertThat(service.submit(request("request_0002")).getTaskId()).isNotEqualTo(id);
        }
    }

    @Test void grantFailureRollsBackAllWritesAndCannotReportSuccess() {
        doAnswer(call -> {
            jdbc.update("INSERT INTO test_grants VALUES (13, 100)");
            throw new BaseException("permission revoked");
        }).when(auth).setResourceUsers(any());
        String id = service.submit(request("request_0001")).getTaskId();
        try (var redis = mockStatic(RedisUtil.class)) {
            service.runNext();
            assertThat(service.get(id).getStatus()).isEqualTo("FAILED");
            assertThat(service.get(id).getDataApplied()).isZero();
            assertThat(jdbc.queryForObject("SELECT count(*) FROM test_grants", Integer.class)).isZero();
            redis.verifyNoInteractions();
            assertThat(service.cancel(id).getStatus()).isEqualTo("CANCELLED");
        }
    }

    @Test void expiredLeaseCanBeRecoveredButActiveWorkerCannotBeDuplicated() {
        String id = service.submit(request("request_0001")).getTaskId();
        jdbc.update("UPDATE byai_authorization_task SET status='RUNNING', worker_slot='AUTHORIZATION', lease_token='old', lease_until=? WHERE task_id=?", System.currentTimeMillis()+60000,id);
        service.runNext(); verify(auth, never()).setResourceUsers(any());
        jdbc.update("UPDATE byai_authorization_task SET lease_until=0 WHERE task_id=?",id);
        try (var redis = mockStatic(RedisUtil.class)) {
            service.runNext(); assertThat(service.get(id).getStatus()).isEqualTo("SUCCEEDED");
        }
    }

    @Test void changedLeaseRollsBackGrantWritesAndOutbox() {
        String id = service.submit(request("request_0001")).getTaskId();
        doAnswer(call -> {
            jdbc.update("INSERT INTO test_grants VALUES (13,100)");
            jdbc.update("UPDATE byai_authorization_task SET lease_token='new-owner' WHERE task_id=?",id);
            return null;
        }).when(auth).setResourceUsers(any());
        try (var redis = mockStatic(RedisUtil.class)) {
            service.runNext();
            assertThat(jdbc.queryForObject("SELECT count(*) FROM test_grants",Integer.class)).isZero();
            assertThat(service.get(id).getDataApplied()).isZero(); redis.verifyNoInteractions();
        }
    }

    @Test void revokedOperatorIsRevalidatedBeforeBackgroundWrites() {
        String id = service.submit(request("request_0001")).getTaskId();
        doThrow(new BaseException("permission revoked")).when(auth).validateAuthorizationTask(any(), anyBoolean());
        service.runNext();
        assertThat(service.get(id).getStatus()).isEqualTo("FAILED");
        verify(auth, never()).setResourceUsers(any());
    }

    @Test void delayedCacheRetryUsesCurrentGrantsInsteadOfReplayingRevokedAccess() {
        var mapper = mock(PrivilegeGrantMapper.class);
        ReflectionTestUtils.setField(service, "grants", mapper);
        var current = new com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant();
        when(mapper.selectList(any(com.baomidou.mybatisplus.core.conditions.Wrapper.class))).thenReturn(List.of(current));
        when(auth.buildPrivilegeGrantKey(current)).thenReturn("USER_100_red");
        when(auth.buildPrivilegeGrantValue(current)).thenReturn("TOOL_14");
        AuthorizationCachePlan plan = new AuthorizationCachePlan();
        plan.getAdditions().put("USER_100_red", Set.of("TOOL_13")); // revoked after the failed attempt
        plan.getRemovals().put("USER_100_red", Set.of("TOOL_14")); // granted again after the failed attempt
        try (var redis = mockStatic(RedisUtil.class)) {
            service.reconcileSets(plan);
            redis.verify(() -> RedisUtil.removeSets(Map.of("USER_100_red", Set.of("TOOL_13"))));
            redis.verify(() -> RedisUtil.addSets(Map.of("USER_100_red", Set.of("TOOL_14"))));
        }
    }
}
