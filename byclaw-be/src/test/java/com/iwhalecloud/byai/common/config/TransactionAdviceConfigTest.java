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

class TransactionAdviceConfigTest {

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
