package com.iwhalecloud.byai.manager.application.service.resource;

import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.iwhalecloud.byai.common.config.TransactionAdviceConfig;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeApplicationService;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeRuntimeRefreshService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.resource.ResourceSyncJob;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.resource.ResourceSyncJobMapper;
import com.iwhalecloud.byai.manager.mapper.users.UsersOrganizationMapper;
import com.iwhalecloud.byai.state.application.service.session.ByClawSkillResourceApplicationService;
import java.util.List;
import java.util.UUID;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.*;

class ResourceSyncTransactionTest {
    @ParameterizedTest
    @MethodSource("resourceSyncCases")
    void immediateAndScheduledProxiesCommitBeforeRefreshAndKeepFailuresRetryable(String type, String mode, boolean immediate) {
        var dataSource = new DriverManagerDataSource(
            "jdbc:h2:mem:" + UUID.randomUUID() + ";DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=250", "sa", "");
        var jdbc = new JdbcTemplate(dataSource);
        jdbc.execute("CREATE TABLE employee (id BIGINT PRIMARY KEY, skills VARCHAR, snapshot VARCHAR)");
        jdbc.execute("CREATE TABLE sync_job (id BIGINT PRIMARY KEY, status VARCHAR)");
        jdbc.update("INSERT INTO employee VALUES (20, 'old', 'old')");
        jdbc.update("INSERT INTO sync_job VALUES (100, 'PENDING')");
        var manager = new DataSourceTransactionManager(dataSource);
        var independent = new TransactionTemplate(manager);
        independent.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        var advice = new TransactionAdviceConfig();
        ReflectionTestUtils.setField(advice, "transactionManager", manager);

        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new Configuration(), "sync-tx-test"),
            ResourceSyncJob.class);
        var job = new ResourceSyncJob();
        job.setSyncJobId(100L); job.setResourceId(10L); job.setSyncRevision(1L);
        job.setOperatorUserId(9L); job.setComAcctId(1L); job.setRetryCount(0);
        job.setStatus(ResourceSyncJob.PENDING); job.setAssociationMode("NONE");
        var jobs = mock(ResourceSyncJobMapper.class);
        when(jobs.pending()).thenReturn(List.of(job));
        when(jobs.selectById(100L)).thenReturn(job);
        when(jobs.claim(100L, 0)).thenAnswer(call -> jdbc.update("UPDATE sync_job SET status='RUNNING_V2' WHERE id=100"));
        when(jobs.update(isNull(), any(Wrapper.class))).thenAnswer(call ->
            jdbc.update("UPDATE sync_job SET status=? WHERE id=100", job.getStatus()));

        var resource = new SsResource();
        resource.setResourceId(10L); resource.setResourceBizType(type);
        resource.setComAcctId(1L); resource.setOwnerType("enterprise"); resource.setResourceStatus(2); resource.setThirdSyncRevision(1L);
        var employee = new SsResource(); employee.setResourceId(20L); employee.setComAcctId(1L);
        var resources = mock(SsResourceService.class);
        when(resources.findById(10L)).thenReturn(resource);
        when(resources.findByIdForUpdate(10L)).thenReturn(resource);
        when(resources.findById(20L)).thenReturn(employee);
        when(resources.findByIdForUpdate(20L)).thenReturn(employee);
        var sources = mock(ResourceBindingSourceService.class);
        // A content-only update must also refresh manually associated employees with no automatic source ledger.
        job.setPackageChanged(true);
        var relation = new com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail();
        relation.setResourceId(20L); relation.setRelResourceId(10L);
        var relations = mock(SsResourceRelDetailService.class);
        when(relations.list(any(Wrapper.class))).thenReturn(List.of(relation));
        var employees = mock(DigitalEmployeeApplicationService.class);
        doAnswer(call -> {
            jdbc.update("UPDATE employee SET skills='new' WHERE id=20");
            if ("association-failure".equals(mode)) throw new IllegalStateException("association write failed");
            return null;
        }).when(employees).rebuildAndSaveDigitalEmployeeRelSkills(20L);
        var runtime = mock(DigitalEmployeeRuntimeRefreshService.class);
        doAnswer(call -> {
            // A separate transaction must see the committed claim and skills and can update the same row.
            independent.executeWithoutResult(status -> {
                assertThat(jdbc.queryForObject("SELECT status FROM sync_job WHERE id=100", String.class))
                    .isEqualTo("RUNNING_V2");
                assertThat(jdbc.queryForObject("SELECT skills FROM employee WHERE id=20", String.class))
                    .isEqualTo("new");
                jdbc.update("UPDATE employee SET snapshot=skills WHERE id=20");
                if ("refresh-failure".equals(mode)) throw new IllegalStateException("snapshot write failed");
            });
            return null;
        }).when(runtime).refreshForResourceSync(20L);
        var users = mock(UserService.class);
        var user = new Users(); user.setUserId(9L); user.setUserCode("operator");
        when(users.findById(9L)).thenReturn(user);
        var service = new ResourceSyncReconcileService();
        ReflectionTestUtils.setField(service, "jobs", jobs);
        ReflectionTestUtils.setField(service, "resources", resources);
        ReflectionTestUtils.setField(service, "sources", sources);
        ReflectionTestUtils.setField(service, "relations", relations);
        ReflectionTestUtils.setField(service, "employees", employees);
        ReflectionTestUtils.setField(service, "runtime", runtime);
        ReflectionTestUtils.setField(service, "skills", mock(ByClawSkillResourceApplicationService.class));
        ReflectionTestUtils.setField(service, "users", users);
        ReflectionTestUtils.setField(service, "userOrganizations", mock(UsersOrganizationMapper.class));
        ReflectionTestUtils.setField(service, "transactionManager", manager);
        var factory = new ProxyFactory(service);
        factory.addAdvice(advice.getAdvisor());
        var proxy = (ResourceSyncReconcileService) factory.getProxy();
        var previous = CurrentUserHolder.getLoginInfo();
        try {
            if (immediate) {
                try (var executor = java.util.concurrent.Executors.newSingleThreadExecutor()) {
                    var dispatcher = new ResourceSyncDispatcher(proxy, executor, 5000);
                    new TransactionTemplate(manager).executeWithoutResult(status -> {
                        jdbc.update("UPDATE sync_job SET status='PENDING_V2' WHERE id=100");
                        org.springframework.transaction.support.TransactionSynchronizationManager.registerSynchronization(
                            new org.springframework.transaction.support.TransactionSynchronization() {
                                @Override public void afterCommit() {
                                    assertThat(dispatcher.dispatch(100L)).containsEntry("status",
                                        "success".equals(mode) ? "COMPLETED" : "PARTIAL");
                                }
                            });
                    });
                }
            } else proxy.reconcilePending();
            assertThat(CurrentUserHolder.getLoginInfo()).isSameAs(previous);
            assertThat(jdbc.queryForObject("SELECT skills FROM employee WHERE id=20", String.class))
                .isEqualTo("association-failure".equals(mode) ? "old" : "new");
            assertThat(jdbc.queryForObject("SELECT snapshot FROM employee WHERE id=20", String.class))
                .isEqualTo("success".equals(mode) ? "new" : "old");
            assertThat(jdbc.queryForObject("SELECT status FROM sync_job WHERE id=100", String.class))
                .isEqualTo("success".equals(mode) ? "COMPLETED" : "PARTIAL_V2");
            if (!"success".equals(mode)) {
                assertThat(com.alibaba.fastjson.JSON.parseObject(job.getResultSummary()).getJSONArray("failedEmployeeIds"))
                    .containsExactly("20");
                assertThat(job.getNextRetryTime()).isNotNull();
            }
            if ("association-failure".equals(mode)) verifyNoInteractions(runtime);
        } finally {
            CurrentUserHolder.setLoginInfo(previous);
            jdbc.execute("SHUTDOWN");
        }
    }

    private static java.util.stream.Stream<Arguments> resourceSyncCases() {
        return java.util.stream.Stream.of("SKILL", "TOOLKIT", "MCP", "AGENT", "KG_DOC", "KG_DB", "KG_QA", "KG_TERM")
            .flatMap(type -> java.util.stream.Stream.of("success", "association-failure", "refresh-failure")
                .flatMap(mode -> java.util.stream.Stream.of(false, true).map(immediate -> Arguments.of(type, mode, immediate))));
    }
}
