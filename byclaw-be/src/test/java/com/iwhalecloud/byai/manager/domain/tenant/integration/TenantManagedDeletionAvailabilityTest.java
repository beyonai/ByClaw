package com.iwhalecloud.byai.manager.domain.tenant.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.hook.HookPublisher;
import com.iwhalecloud.byai.gateway.sandbox.service.TenantSandboxService;
import com.iwhalecloud.byai.manager.domain.tenant.policy.TenantExecutionPolicyService;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class TenantManagedDeletionAvailabilityTest {
    @Test void administratorDeletionIsAvailableWithExternalIntegrationDisabledOrUnconfigured() {
        var context = new ApplicationContextRunner()
            .withUserConfiguration(TenantManagedDeletionService.class)
            .withInitializer(c -> {
                var beans=c.getBeanFactory();
                beans.registerSingleton("store",mock(TenantCommandStore.class));
                beans.registerSingleton("jdbc",mock(JdbcTemplate.class));
                beans.registerSingleton("transactions",mock(PlatformTransactionManager.class));
                beans.registerSingleton("tenants",mock(TenantAdminTenantMapper.class));
                beans.registerSingleton("sandboxes",mock(TenantSandboxService.class));
                beans.registerSingleton("policies",mock(TenantExecutionPolicyService.class));
                beans.registerSingleton("ids",mock(SequenceService.class));
                beans.registerSingleton("json",new ObjectMapper());
                beans.registerSingleton("hooks",mock(HookPublisher.class));
                beans.registerSingleton("redis",mock(StringRedisTemplate.class));
            });
        context.run(c -> assertThat(c).hasSingleBean(TenantManagedDeletionService.class));
        context.withPropertyValues("byclaw.integration.enabled=false")
            .run(c -> assertThat(c).hasSingleBean(TenantManagedDeletionService.class));
        context.withPropertyValues("byclaw.integration.enabled=true")
            .run(c -> assertThat(c).hasSingleBean(TenantManagedDeletionService.class));
    }
}
