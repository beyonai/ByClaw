package com.iwhalecloud.byai.common.config;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.interceptor.TransactionAttribute;
import org.springframework.transaction.interceptor.TransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;

import java.lang.reflect.Method;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

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
        assertThat(resolvePropagation(source, "createSomethingElse"))
            .isEqualTo(TransactionDefinition.PROPAGATION_REQUIRED);
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

        public void createSomethingElse() {
        }
    }
}
