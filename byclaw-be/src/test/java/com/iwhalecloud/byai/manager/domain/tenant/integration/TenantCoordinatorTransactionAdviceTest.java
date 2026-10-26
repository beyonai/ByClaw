package com.iwhalecloud.byai.manager.domain.tenant.integration;

import com.iwhalecloud.byai.common.config.TransactionAdviceConfig;
import com.iwhalecloud.byai.manager.domain.tenant.TenantDbProvisioningService;
import com.iwhalecloud.byai.manager.domain.tenant.policy.TenantExecutionPolicyService;
import org.junit.jupiter.api.Test;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class TenantCoordinatorTransactionAdviceTest {
    @Test
    void globalAdviceLeavesCoordinatorTransactionsAndRollbackRecoveryIndependent() throws Exception {
        var source = new DriverManagerDataSource("jdbc:h2:mem:coordinator_" + java.util.UUID.randomUUID()
            + ";DB_CLOSE_DELAY=-1", "sa", "");
        var manager = new DataSourceTransactionManager(source);
        var jdbc = new JdbcTemplate(source);
        jdbc.execute("CREATE TABLE step(id integer PRIMARY KEY,status varchar(16))");
        var config = new TransactionAdviceConfig();
        ReflectionTestUtils.setField(config, "transactionManager", manager);
        var advice = config.getAdvisor();
        var attributes = advice.getTransactionAttributeSource();
        assertThat(attributes.getTransactionAttribute(TenantDbProvisioningService.class.getMethod("provisionDurably",
            long.class, TenantProvisioningGuard.class), TenantDbProvisioningService.class).getPropagationBehavior())
            .isEqualTo(TransactionDefinition.PROPAGATION_NOT_SUPPORTED);
        assertThat(attributes.getTransactionAttribute(TenantExecutionPolicyService.class.getMethod("prepare",
            long.class, com.fasterxml.jackson.databind.JsonNode.class), TenantExecutionPolicyService.class).getPropagationBehavior())
            .isEqualTo(TransactionDefinition.PROPAGATION_REQUIRED);
        var target = mock(TenantCommandService.class);
        when(target.provision(null)).thenAnswer(invocation -> {
            assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
            var tx = new TransactionTemplate(manager);
            tx.executeWithoutResult(status -> jdbc.update("INSERT INTO step VALUES (1,'STARTED')"));
            // A separate physical connection observes intent committed before the external call.
            assertThat(new JdbcTemplate(source).queryForObject("SELECT status FROM step WHERE id=1", String.class)).isEqualTo("STARTED");
            assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
            try {
                tx.executeWithoutResult(status -> {
                    jdbc.update("INSERT INTO step VALUES (2,'PENDING')");
                    jdbc.update("INSERT INTO step VALUES (1,'DUPLICATE')");
                });
            } catch (org.springframework.dao.DuplicateKeyException expected) {
                assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
                assertThat(jdbc.queryForObject("SELECT count(*) FROM step WHERE id=2", Integer.class)).isZero();
            }
            return null;
        });
        var factory = new ProxyFactory(target);
        factory.setProxyTargetClass(true);
        factory.addAdvice(advice);
        var coordinator = (TenantCommandService) factory.getProxy();
        new TransactionTemplate(manager).executeWithoutResult(status -> {
            coordinator.provision(null);
            assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isTrue();
        });
        assertThat(jdbc.queryForObject("SELECT count(*) FROM step", Integer.class)).isEqualTo(1);
    }
}
