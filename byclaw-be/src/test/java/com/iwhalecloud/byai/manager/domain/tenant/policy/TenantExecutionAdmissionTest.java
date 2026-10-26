package com.iwhalecloud.byai.manager.domain.tenant.policy;

import org.junit.jupiter.api.Test;
import org.springframework.aop.aspectj.annotation.AspectJProxyFactory;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class TenantExecutionAdmissionTest {
    @Test void deniedExecutionNeverReachesBusinessMethod() {
        var policies = mock(TenantExecutionPolicyService.class);
        doThrow(new TenantExecutionPolicyService.PolicyDeniedException("POLICY_EXECUTION_DISABLED"))
            .when(policies).requireCurrentExecution();
        var advice = new TenantExecutionAdmission(policies);
        assertThrows(TenantExecutionPolicyService.PolicyDeniedException.class, advice::requireCurrentExecution);
    }
}
