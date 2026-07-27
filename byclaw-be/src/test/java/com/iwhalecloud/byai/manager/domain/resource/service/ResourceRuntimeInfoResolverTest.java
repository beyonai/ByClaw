package com.iwhalecloud.byai.manager.domain.resource.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.iwhalecloud.byai.common.constants.resource.DigitalEmployType;
import com.iwhalecloud.byai.common.constants.resource.ImplType;
import com.iwhalecloud.byai.common.constants.resource.WorkerAgentType;
import org.junit.jupiter.api.Test;

class ResourceRuntimeInfoResolverTest {

    private final ResourceRuntimeInfoResolver resolver = new ResourceRuntimeInfoResolver();

    @Test
    void resolveDigitalEmployee_routesDefaultSuperAssistantToBySuper() {
        ResourceRuntimeInfo result = resolver.resolveDigitalEmployee(
            DigitalEmployType.AGENT_TYPE_ASSISTANT.getCode(), 1001L, "user001_main");

        assertThat(result.getImplType()).isEqualTo(ImplType.ASK_AGENT.getCode());
        assertThat(result.getWorkerAgentType()).isEqualTo(WorkerAgentType.BY_SUPER.getCode());
    }

    @Test
    void resolveDigitalEmployee_keepsRegularAssistantOnByclawExe() {
        ResourceRuntimeInfo result = resolver.resolveDigitalEmployee(
            DigitalEmployType.AGENT_TYPE_ASSISTANT.getCode(), 1002L, "employee_1002");

        assertThat(result.getImplType()).isEqualTo(ImplType.ASK_AGENT.getCode());
        assertThat(result.getWorkerAgentType()).isEqualTo(WorkerAgentType.BYCLAW_EXE.getCode());
    }
}
