package com.iwhalecloud.byai.manager.domain.tenant.policy;

import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import org.aspectj.lang.JoinPoint;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.annotation.Before;
import org.springframework.stereotype.Component;

/** Rechecks policy for each new Java execution rather than caching admission at login. */
@Aspect
@Component
public class TenantExecutionAdmission {
    private final TenantExecutionPolicyService policies;

    public TenantExecutionAdmission(TenantExecutionPolicyService policies) { this.policies = policies; }

    @Before("execution(* com.iwhalecloud.byai.state.domain.chat.service.AssistantChatService.chat(..))")
    public void requireChatExecution(JoinPoint point) {
        // Netty supplies LoginInfo as a method argument before the thread-local is installed.
        for (Object argument : point.getArgs()) {
            if (argument instanceof LoginInfo info && info.getEnterpriseId() != null) {
                policies.requireExecution(info.getEnterpriseId());
                return;
            }
        }
        requireCurrentExecution();
    }

    @Before("execution(* com.iwhalecloud.byai.gateway.sandbox.service.SandboxService.launchSandbox*(..))"
        + " || execution(* com.iwhalecloud.byai.gateway.sandbox.service.SandboxService.restartSandbox*(..))"
        + " || execution(* com.iwhalecloud.byai.gateway.sandbox.service.SandboxService.renewSandbox(..))")
    public void requireCurrentExecution() { policies.requireCurrentExecution(); }
}
