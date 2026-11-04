package com.iwhalecloud.byai.manager.application.service.resource;

import com.alibaba.fastjson.JSON;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.MybatisSqlSessionFactoryBuilder;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.resource.ResourceSyncJob;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.resource.ResourceSyncJobMapper;
import com.iwhalecloud.byai.manager.mapper.users.UsersOrganizationMapper;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.LongStream;
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

/** Real SQL, transactions, leases and resumable checkpoints; only external runtime/cache calls are stubbed. */
class ResourceSyncAsyncJobTest {
    private JdbcTemplate jdbc;
    private ResourceSyncJobMapper jobs;
    private ResourceSyncReconcileService worker;
    private EnterpriseResourceSyncService sync;
    private AuthApplicationService auth;
    private SsResource resource;

    @BeforeEach void setup() {
        var source = new UnpooledDataSource("org.h2.Driver", "jdbc:h2:mem:" + UUID.randomUUID() + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1", "sa", "");
        jdbc = new JdbcTemplate(source);
        jdbc.execute("CREATE SCHEMA byai");
        jdbc.execute("CREATE TABLE byai.ss_resource(resource_id BIGINT PRIMARY KEY,third_sync_revision BIGINT)");
        jdbc.update("INSERT INTO byai.ss_resource VALUES (10,1)");
        jdbc.execute("CREATE TABLE test_grants (user_id BIGINT PRIMARY KEY)");
        jdbc.execute("CREATE TABLE byai.byai_resource_sync_job (sync_job_id BIGINT PRIMARY KEY,com_acct_id BIGINT,resource_id BIGINT,sync_revision BIGINT,operator_user_id BIGINT,request_id VARCHAR(128),request_hash VARCHAR(64),authorization_intent TEXT,auth_scope TEXT,auth_refresh_user_ids TEXT,association_mode VARCHAR(32),package_changed BOOLEAN,status VARCHAR(32),result_summary TEXT,retry_count INT,retry_limit INT DEFAULT 8,next_retry_time TIMESTAMP,create_time TIMESTAMP,update_time TIMESTAMP,UNIQUE(resource_id,request_id))");
        var config = new MybatisConfiguration(new Environment("test", new SpringManagedTransactionFactory(), source));
        config.setMapUnderscoreToCamelCase(true); config.addMapper(ResourceSyncJobMapper.class);
        jobs = new SqlSessionTemplate(new MybatisSqlSessionFactoryBuilder().build(config)).getMapper(ResourceSyncJobMapper.class);
        var resources = mock(SsResourceService.class);
        resource = new SsResource(); resource.setResourceId(10L); resource.setOwnerType("enterprise");
        resource.setResourceBizType("TOOLKIT"); resource.setResourceStatus(2); resource.setThirdSyncRevision(1L);
        when(resources.findById(10L)).thenReturn(resource); when(resources.findByIdForUpdate(10L)).thenReturn(resource);
        sync = mock(EnterpriseResourceSyncService.class); auth = mock(AuthApplicationService.class);
        var users = mock(UserService.class); var user = new Users(); user.setUserId(9L); user.setUserCode("adminvip");
        when(users.findById(9L)).thenReturn(user);
        worker = new ResourceSyncReconcileService();
        Map<String, Object> fields = Map.of("jobs",jobs,"resources",resources,"sync",sync,"auth",auth,"users",users,
            "userOrganizations",mock(UsersOrganizationMapper.class),"transactionManager",new DataSourceTransactionManager(source),
            "sources",mock(ResourceBindingSourceService.class),"relations",mock(SsResourceRelDetailService.class));
        fields.forEach((key,value)->ReflectionTestUtils.setField(worker,key,value));
        var job = new ResourceSyncJob(); job.setSyncJobId(100L); job.setComAcctId(1L); job.setResourceId(10L);
        job.setSyncRevision(1L); job.setOperatorUserId(9L); job.setRequestId("request-1"); job.setRequestHash("hash");
        job.setAuthorizationIntent("{}"); job.setAuthRefreshUserIds("[]"); job.setAssociationMode("NONE");
        job.setPackageChanged(false); job.setStatus(ResourceSyncJob.PENDING); job.setResultSummary("{}");
        job.setRetryCount(0); job.setNextRetryTime(new Date()); job.setCreateTime(new Date()); job.setUpdateTime(new Date());
        jobs.insert(job);
    }
    @AfterEach void cleanup() { worker.shutdown(); CurrentUserHolder.setLoginInfo(null); jdbc.execute("SHUTDOWN"); }

    @Test void cacheFailureResumesAfterCommittedBatchWithoutReapplyingGrants() {
        Set<Long> recipients = new LinkedHashSet<>(LongStream.rangeClosed(1,250).boxed().toList());
        when(sync.applyAuthorization(any(),any())).thenAnswer(call->{ jdbc.update("INSERT INTO test_grants VALUES(1)"); return recipients; });
        AtomicInteger calls = new AtomicInteger();
        doAnswer(call->{ if(calls.incrementAndGet()==2) throw new IllegalStateException("cache unavailable"); return null; })
            .when(auth).refreshResourceSyncAuth(any(SsResource.class),anyCollection());
        assertThat(worker.reconcileNow(100L).publicStatus()).isEqualTo("FAILED");
        var failed = jobs.selectById(100L);
        assertThat(JSON.parseObject(failed.getResultSummary()).getIntValue("completedUsers")).isEqualTo(100);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM test_grants",Integer.class)).isEqualTo(1);
        jdbc.update("UPDATE byai.byai_resource_sync_job SET next_retry_time=CURRENT_TIMESTAMP WHERE sync_job_id=100");
        assertThat(worker.reconcileNow(100L).publicStatus()).isEqualTo("COMPLETED");
        verify(sync,times(1)).applyAuthorization(any(),any());
        assertThat(calls.get()).isEqualTo(4); // 100 success + 100 failure; restart processes only 100 + 50.
        assertThat(JSON.parseObject(jobs.selectById(100L).getResultSummary()).getIntValue("completedUsers")).isEqualTo(250);
    }

    @Test void failedAuthorizationTransactionRollsBackBothGrantsAndCheckpoint() {
        when(sync.applyAuthorization(any(),any())).thenAnswer(call->{jdbc.update("INSERT INTO test_grants VALUES(1)");throw new IllegalStateException("write failed");});
        worker.reconcileNow(100L);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM test_grants",Integer.class)).isZero();
        assertThat(JSON.parseObject(jobs.selectById(100L).getResultSummary()).getBooleanValue("authorizationApplied")).isFalse();
        verifyNoInteractions(auth);
    }

    @Test void staleRevisionNeverWritesPermissionsAndTwoWorkersCannotClaimSameAttempt() {
        assertThat(jobs.claim(100L,0)).isEqualTo(1);
        assertThat(jobs.claim(100L,0)).isZero();
        assertThat(jobs.owned(100L,1)).isEqualTo(1);
        assertThat(jobs.owned(100L,2)).isZero();
        jdbc.update("UPDATE byai.byai_resource_sync_job SET update_time=CURRENT_TIMESTAMP - INTERVAL '3' MINUTE");
        resource.setThirdSyncRevision(2L); jdbc.update("UPDATE byai.ss_resource SET third_sync_revision=2");
        assertThat(worker.reconcileNow(100L).publicStatus()).isEqualTo("SUPERSEDED");
        verifyNoInteractions(sync,auth);
        assertThat(jobs.fenceResource(10L,1L)).isZero();
    }

    @Test void idempotencyAndLatestBatchUsePersistentRequestAndRevisionIndexes() {
        assertThat(jobs.byRequest(10L,"request-1").getSyncJobId()).isEqualTo(100L);
        assertThat(jobs.latestBatch(List.of(10L,20L))).extracting(ResourceSyncJob::getSyncJobId).containsExactly(100L);
        assertThat(jobs.latest(10L).getRequestHash()).isEqualTo("hash");
        var guard = new EnterpriseResourceSyncService(); ReflectionTestUtils.setField(guard,"jobs",jobs);
        ReflectionTestUtils.setField(guard,"auth",auth);
        var login = new com.iwhalecloud.byai.common.login.bean.LoginInfo(); login.setUserId(9L); CurrentUserHolder.setLoginInfo(login);
        when(auth.isCurrentUserGlobalResourceManager()).thenReturn(true);
        assertThat(guard.repeated(10L,"request-1","hash").getSyncJobId()).isEqualTo(100L);
        assertThatThrownBy(()->guard.repeated(10L,"request-1","other")).isInstanceOf(IllegalArgumentException.class);
    }
}
