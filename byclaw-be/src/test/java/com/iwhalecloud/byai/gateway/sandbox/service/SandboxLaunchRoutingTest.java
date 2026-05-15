package com.iwhalecloud.byai.gateway.sandbox.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class SandboxLaunchRoutingTest {

    @Test
    void openclawAlwaysUsesDefaultResourceId() {
        SandboxLaunchRouting routing = new SandboxLaunchRouting(SandboxLaunchRouting.DEFAULT_SANDBOX_TYPE, 1001L);

        assertThat(routing.getSandboxType()).isEqualTo(SandboxLaunchRouting.DEFAULT_SANDBOX_TYPE);
        assertThat(routing.getEffectiveResourceId()).isEqualTo(SandboxLaunchRouting.DEFAULT_RESOURCE_ID);
    }

    @Test
    void codeAgentAlwaysUsesDefaultCodeAgentResourceId() {
        SandboxLaunchRouting routing = new SandboxLaunchRouting(
            SandboxLaunchRouting.BYCLAW_CODE_AGENT_SANDBOX_TYPE, 1001L);

        assertThat(routing.getEffectiveResourceId()).isEqualTo(SandboxLaunchRouting.DEFAULT_CODE_AGENT_RESOURCE_ID);
    }

    @Test
    void customSandboxTypeKeepsOriginalResourceId() {
        SandboxLaunchRouting routing = new SandboxLaunchRouting("custom", 1001L);

        assertThat(routing.getEffectiveResourceId()).isEqualTo(1001L);
    }
}
