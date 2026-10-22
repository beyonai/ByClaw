package com.iwhalecloud.byai.common.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

import java.lang.reflect.Method;
import javax.sql.DataSource;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.chat.service.SessionRuntimeStateService;
import com.iwhalecloud.byai.state.domain.chat.service.ScopedSessionEventService;
import com.iwhalecloud.byai.state.domain.chat.service.RunningChatSnapshotService;
import com.iwhalecloud.byai.state.domain.chat.service.CronService;
import com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService;
import com.iwhalecloud.byai.state.domain.message.service.MemoryMessageService;
import org.junit.jupiter.api.Test;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.interceptor.TransactionAttribute;
import org.springframework.transaction.interceptor.TransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;

class TransactionAdviceConfigTest extends com.iwhalecloud.byai.common.i18n.I18nTestSupport {

    @Test
    void forwardingTransportSuspendsAnActualCallerTransaction() {
        var ds=new org.springframework.jdbc.datasource.DriverManagerDataSource("jdbc:h2:mem:forwardAdvice;DB_CLOSE_DELAY=-1","sa","");
        var manager=new DataSourceTransactionManager(ds);var config=new TransactionAdviceConfig();ReflectionTestUtils.setField(config,"transactionManager",manager);
        var node=mock(com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient.class);
        org.mockito.Mockito.when(node.request(org.mockito.ArgumentMatchers.any(),org.mockito.ArgumentMatchers.eq("GET"),org.mockito.ArgumentMatchers.anyString(),org.mockito.ArgumentMatchers.isNull(),org.mockito.ArgumentMatchers.any())).thenAnswer(inv->{
            assertThat(org.springframework.transaction.support.TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
            return new com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.ForwardOperation(3,com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.ForwardOperationState.SUCCEEDED,java.util.List.of());
        });
        var target=new com.iwhalecloud.byai.manager.domain.tenant.TenantGroupForwardService(node,mock(com.iwhalecloud.byai.state.domain.groupchat.forward.application.ForwardPlatformPolicy.class),new com.iwhalecloud.byai.state.domain.groupchat.forward.config.GroupChatForwardProperties());
        var factory=new ProxyFactory(target);factory.setProxyTargetClass(true);factory.addAdvice(config.getAdvisor());var proxy=(com.iwhalecloud.byai.manager.domain.tenant.TenantGroupForwardService)factory.getProxy();
        new org.springframework.transaction.support.TransactionTemplate(manager).execute(status->{assertThat(org.springframework.transaction.support.TransactionSynchronizationManager.isActualTransactionActive()).isTrue();proxy.status(new com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.ForwardActor(1,2),4,3);assertThat(org.springframework.transaction.support.TransactionSynchronizationManager.isActualTransactionActive()).isTrue();return null;});
    }

    @Test
    void commonFileFallbackCannotMarkTheCallingChatRollbackOnly() throws Exception {
        TransactionAdviceConfig config = new TransactionAdviceConfig();
        ReflectionTestUtils.setField(config, "transactionManager", mock(DataSourceTransactionManager.class));
        var source = config.getAdvisor().getTransactionAttributeSource();
        var service = com.iwhalecloud.byai.manager.application.service.files.FilesApplicationService.class;
        Method read = service.getMethod("openCommonFileInputStream", String.class, String.class);
        assertThat(source.getTransactionAttribute(read, service).getPropagationBehavior())
            .isEqualTo(TransactionDefinition.PROPAGATION_NOT_SUPPORTED);
        assertThat(source.getTransactionAttribute(TxMethodSamples.class.getMethod("openCommonFileInputStream"),
            TxMethodSamples.class).getPropagationBehavior()).isEqualTo(TransactionDefinition.PROPAGATION_REQUIRED);
    }

    @Test
    void workspaceSkillCenterOwnsItsCommitBeforeFileCleanup() throws Exception {
        TransactionAdviceConfig config = new TransactionAdviceConfig();
        ReflectionTestUtils.setField(config, "transactionManager", mock(DataSourceTransactionManager.class));
        var source = config.getAdvisor().getTransactionAttributeSource();
        var service = com.iwhalecloud.byai.state.application.service.session.WorkspaceSkillCenterApplicationService.class;
        var request = com.iwhalecloud.byai.state.domain.resource.qo.WorkspaceSkillCenterQo.class;
        for (String method : new String[] {"preview", "sync"}) {
            assertThat(source.getTransactionAttribute(service.getMethod(method, request), service).getPropagationBehavior())
                .isEqualTo(TransactionDefinition.PROPAGATION_NOT_SUPPORTED);
        }
        assertThat(resolvePropagation(source, "createSomethingElse"))
            .isEqualTo(TransactionDefinition.PROPAGATION_REQUIRED);
    }

    @Test
    void publicationTransactionsDoNotChangeOrdinaryEmployeeSync() throws Exception {
        TransactionAdviceConfig config = new TransactionAdviceConfig();
        ReflectionTestUtils.setField(config, "transactionManager", mock(DataSourceTransactionManager.class));
        var source = config.getAdvisor().getTransactionAttributeSource();
        var coordinator = com.iwhalecloud.byai.manager.application.service.digitemploy.EmployeePublicationApplicationService.class;
        for (Method method : coordinator.getDeclaredMethods()) {
            if (java.lang.reflect.Modifier.isPublic(method.getModifiers())) {
                assertThat(source.getTransactionAttribute(method, coordinator).getPropagationBehavior())
                    .as(method.getName()).isEqualTo(TransactionDefinition.PROPAGATION_NOT_SUPPORTED);
            }
        }
        var employee = com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeApplicationService.class;
        var dto = com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDTO.class;
        assertThat(source.getTransactionAttribute(employee.getMethod("synOpenClawWorkSpace", Long.class, dto), employee).getPropagationBehavior())
            .isEqualTo(TransactionDefinition.PROPAGATION_NOT_SUPPORTED);
        assertThat(source.getTransactionAttribute(employee.getMethod("syncPublicationOpenClawWorkSpace", Long.class, dto), employee).getPropagationBehavior())
            .isEqualTo(TransactionDefinition.PROPAGATION_REQUIRED);
        assertThat(source.getTransactionAttribute(employee.getMethod("restorePublicationRuntimeAfterRollback", Long.class), employee).getPropagationBehavior())
            .isEqualTo(TransactionDefinition.PROPAGATION_NOT_SUPPORTED);
    }

    @Test
    void streamClassificationDoesNotBorrowADatabaseConnection() {
        DataSource dataSource = mock(DataSource.class);
        TransactionAdviceConfig config = new TransactionAdviceConfig();
        ReflectionTestUtils.setField(config, "transactionManager", new DataSourceTransactionManager(dataSource));
        ProxyFactory factory = new ProxyFactory(new SessionRuntimeStateService());
        factory.addAdvice(config.getAdvisor());
        SessionRuntimeStateService service = (SessionRuntimeStateService) factory.getProxy();
        JSONObject event = JSONObject.parseObject("{\"metadata\":{\"event_kind\":\"session.runtime\","
            + "\"session_scope\":\"parent\"}}");

        assertThat(service.isRuntimeEvent(event)).isTrue();
        ProxyFactory cronFactory = new ProxyFactory(new CronService(null, null));
        cronFactory.addAdvice(config.getAdvisor());
        CronService cronService = (CronService) cronFactory.getProxy();
        assertThat(cronService.isCronChangedEvent("answerDelta")).isFalse();
        verifyNoInteractions(dataSource);
    }

    @Test
    void streamInfrastructureIsNonTransactionalWithoutChangingBusinessWrites() throws Exception {
        TransactionAdviceConfig config = new TransactionAdviceConfig();
        ReflectionTestUtils.setField(config, "transactionManager", mock(DataSourceTransactionManager.class));
        TransactionAttributeSource source = config.getAdvisor().getTransactionAttributeSource();
        for (Class<?> type : new Class<?>[] {SessionRuntimeStateService.class, ScopedSessionEventService.class,
                RunningChatSnapshotService.class, MultiDeviceBroadcastService.class}) {
            for (Method method : type.getDeclaredMethods()) {
                if (java.lang.reflect.Modifier.isPublic(method.getModifiers())) {
                    assertThat(source.getTransactionAttribute(method, type).getPropagationBehavior())
                        .as(type.getSimpleName() + "." + method.getName())
                        .isEqualTo(TransactionDefinition.PROPAGATION_NOT_SUPPORTED);
                }
            }
        }
        Method save = java.util.Arrays.stream(MemoryMessageService.class.getMethods())
            .filter(method -> method.getName().equals("save")).findFirst().orElseThrow();
        assertThat(source.getTransactionAttribute(save, MemoryMessageService.class).getPropagationBehavior())
            .isEqualTo(TransactionDefinition.PROPAGATION_REQUIRED);
        assertThat(resolvePropagation(source, "createSomethingElse"))
            .isEqualTo(TransactionDefinition.PROPAGATION_REQUIRED);
    }

    @Test
    void defaultResourceInitializationMethodsDoNotJoinGlobalTransactions() throws Exception {
        TransactionAdviceConfig config = new TransactionAdviceConfig();
        ReflectionTestUtils.setField(config, "transactionManager", mock(DataSourceTransactionManager.class));
        TransactionInterceptor interceptor = config.getAdvisor();
        TransactionAttributeSource source = interceptor.getTransactionAttributeSource();

        assertThat(resolvePropagation(source, "createDatasetIfNotExists"))
            .isEqualTo(TransactionDefinition.PROPAGATION_NOT_SUPPORTED);
        assertThat(resolvePropagation(source, "createDefaultResourcesIfNotExists"))
            .isEqualTo(TransactionDefinition.PROPAGATION_NOT_SUPPORTED);
        assertThat(resolvePropagation(source, "syncResourceJsonByBizType"))
            .isEqualTo(TransactionDefinition.PROPAGATION_NOT_SUPPORTED);
        assertThat(resolvePropagation(source, "existsResourceJsonByBizType"))
            .isEqualTo(TransactionDefinition.PROPAGATION_NOT_SUPPORTED);
        assertThat(resolvePropagation(source, "upsertStandardJsonArtifact"))
            .isEqualTo(TransactionDefinition.PROPAGATION_NOT_SUPPORTED);
        assertThat(resolvePropagation(source, "prewarmDueCronSandboxes"))
            .isEqualTo(TransactionDefinition.PROPAGATION_NOT_SUPPORTED);
        assertThat(resolvePropagation(source, "callAsUser"))
            .isEqualTo(TransactionDefinition.PROPAGATION_NOT_SUPPORTED);
        assertThat(resolvePropagation(source, "runAsUser"))
            .isEqualTo(TransactionDefinition.PROPAGATION_NOT_SUPPORTED);
        assertThat(resolvePropagation(source, "createSomethingElse"))
            .isEqualTo(TransactionDefinition.PROPAGATION_REQUIRED);
    }

    @Test
    void saveAdapterDoesNotJoinTheGlobalDatabaseTransaction() throws Exception {
        TransactionAdviceConfig config = new TransactionAdviceConfig();
        ReflectionTestUtils.setField(config, "transactionManager", mock(DataSourceTransactionManager.class));
        TransactionInterceptor interceptor = config.getAdvisor();

        assertThat(resolvePropagation(interceptor.getTransactionAttributeSource(), "saveAdapter"))
            .isEqualTo(TransactionDefinition.PROPAGATION_NOT_SUPPORTED);
    }

    private int resolvePropagation(TransactionAttributeSource source, String methodName) throws NoSuchMethodException {
        Method method = TxMethodSamples.class.getMethod(methodName);
        TransactionAttribute attribute = source.getTransactionAttribute(method, TxMethodSamples.class);
        assertThat(attribute).isNotNull();
        return attribute.getPropagationBehavior();
    }

    static class TxMethodSamples {

        public void openCommonFileInputStream() {
        }

        public void createDatasetIfNotExists() {
        }

        public void createDefaultResourcesIfNotExists() {
        }

        public void syncResourceJsonByBizType() {
        }

        public void existsResourceJsonByBizType() {
        }

        public void upsertStandardJsonArtifact() {
        }

        public void prewarmDueCronSandboxes() {
        }

        public void callAsUser() {
        }

        public void runAsUser() {
        }

        public void createSomethingElse() {
        }

        public void saveAdapter() {
        }
    }
}
