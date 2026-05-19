package com.iwhalecloud.byai.gateway.sandbox.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;

@ExtendWith(MockitoExtension.class)
class SandboxLaunchContextFactoryTest {

    @InjectMocks
    private SandboxLaunchContextFactory factory;

    @Mock
    private SsResExtDigEmployeeService ssResExtDigEmployeeService;

    @Mock
    private SandboxUserInfoFactory sandboxUserInfoFactory;

    @Test
    void buildContext_generatesRandomGatewayTokenAndInjectsItIntoEnvs() {
        SandboxLaunchContext first = factory.buildContext("user001", 100L,
            SandboxLaunchRouting.DEFAULT_SANDBOX_TYPE);
        SandboxLaunchContext second = factory.buildContext("user001", 100L,
            SandboxLaunchRouting.DEFAULT_SANDBOX_TYPE);

        assertThat(first.getGatewayToken()).matches("[0-9a-f]{32}");
        assertThat(second.getGatewayToken()).matches("[0-9a-f]{32}");
        assertThat(first.getGatewayToken()).isNotEqualTo(second.getGatewayToken());
        assertThat(first.getEnvs())
            .containsEntry("gateway_token", first.getGatewayToken())
            .containsEntry("OPENCLAW_GATEWAY_TOKEN", first.getGatewayToken());
    }
}
