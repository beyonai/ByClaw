package com.iwhalecloud.byai.common.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import java.lang.reflect.Method;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.interceptor.TransactionAttribute;
import org.springframework.transaction.interceptor.TransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;

class TransactionAdviceConfigTest {

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
