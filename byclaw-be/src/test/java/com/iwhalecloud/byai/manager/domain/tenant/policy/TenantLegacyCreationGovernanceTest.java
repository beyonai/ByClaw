package com.iwhalecloud.byai.manager.domain.tenant.policy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.application.service.enterprise.EnterpriseInfoApplicationService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantAdminTenantService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.support.DefaultListableBeanFactory;
import java.time.Clock;
import static org.junit.jupiter.api.Assertions.*;

class TenantLegacyCreationGovernanceTest {
    private TenantExecutionPolicyService policy(boolean enabled) {
        return new TenantExecutionPolicyService(null, new ObjectMapper(), enabled, Clock.systemUTC());
    }

    @Test void enabledPolicyRejectsLegacyCreationWithoutAnyDatabaseLookup() {
        assertThrows(TenantExecutionPolicyService.PolicyDeniedException.class,
            () -> policy(true).requireLegacyCreationAllowed());
    }

    @Test void disabledPolicyPreservesLegacyCreationGate() {
        assertDoesNotThrow(() -> policy(false).requireLegacyCreationAllowed());
    }

    @Test void enabledPolicyBlocksBothExistingCreationEntrancesBeforeMutation() {
        var factory = new DefaultListableBeanFactory();
        factory.registerSingleton("policies", policy(true));
        var provider = factory.getBeanProvider(TenantExecutionPolicyService.class);
        var ordinary = new EnterpriseInfoApplicationService();
        ordinary.setTenantExecutionPolicies(provider);
        var administrator = new TenantAdminTenantService(null, null, null, null);
        administrator.setTenantExecutionPolicies(provider);
        assertThrows(TenantExecutionPolicyService.PolicyDeniedException.class, () -> ordinary.create(null));
        assertThrows(TenantExecutionPolicyService.PolicyDeniedException.class,
            () -> administrator.create("tenant", 1L, "request-001"));
    }
}
