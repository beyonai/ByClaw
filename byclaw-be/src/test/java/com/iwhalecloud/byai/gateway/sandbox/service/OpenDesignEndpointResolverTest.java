package com.iwhalecloud.byai.gateway.sandbox.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.common.jwt.JwtService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.gateway.sandbox.config.SandboxProperties;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.gateway.sandbox.model.opendesign.OpenDesignRequestEnvironment;
import com.iwhalecloud.byai.gateway.sandbox.service.ingress.OpenSandboxIngressRuntimeSupport;
import com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressEndpointResolver;
import com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressRuntimeResolver;
import com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressRuntimeSupport;
import com.iwhalecloud.byai.gateway.sandbox.service.ingress.WhaleAgentIngressRuntimeSupport;

class OpenDesignEndpointResolverTest {

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void resolve_usesCurrentUsersOpenDesignIngressEndpoint() {
        SandboxProperties sandboxProperties = new SandboxProperties();
        sandboxProperties.getOpensandbox().setBaseUrl("http://opensandbox.test");
        sandboxProperties.getOpensandbox().setApiKey("sandbox-api-key");
        sandboxProperties.setOpenDesignAgentId("agent-1");
        sandboxProperties.setOpenDesignDefaultSkillId("skill-1");
        sandboxProperties.setOpenDesignDefaultDesignSystemId("design-system-1");

        SandboxService sandboxService = mock(SandboxService.class);
        when(sandboxService.sandboxInfo("alice")).thenReturn(List.of(SandboxInfo.builder()
            .userCode("alice")
            .sandboxId("sb-1")
            .instanceEndpoints(Map.of("openDesign", "/v1/sandboxes/sb-1/proxy/18090"))
            .build()));

        JwtService jwtService = mock(JwtService.class);
        when(jwtService.createJwt(org.mockito.ArgumentMatchers.any())).thenReturn("generated-token");

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserCode("alice");
        CurrentUserHolder.setLoginInfo(loginInfo);

        SandboxIngressRuntimeSupport openSandboxSupport = new OpenSandboxIngressRuntimeSupport(sandboxProperties);
        SandboxIngressRuntimeSupport whaleAgentSupport = new WhaleAgentIngressRuntimeSupport("", sandboxProperties);
        OpenDesignEndpointResolver resolver = new OpenDesignEndpointResolver(sandboxProperties,
            new SandboxIngressEndpointResolver(sandboxService),
            new SandboxIngressRuntimeResolver(List.of(openSandboxSupport, whaleAgentSupport), "minio"),
            jwtService);

        OpenDesignRequestEnvironment env = resolver.resolve();

        assertThat(env.getDaemonBaseUrl())
            .isEqualTo("http://opensandbox.test/v1/sandboxes/sb-1/proxy/18090/openDesign");
        assertThat(env.getRedirectRoutePrefix()).isEqualTo("/openDesign");
        assertThat(env.getAgentId()).isEqualTo("agent-1");
        assertThat(env.getDefaultSkillId()).isEqualTo("skill-1");
        assertThat(env.getDefaultDesignSystemId()).isEqualTo("design-system-1");
        assertThat(env.getHeaders())
            .containsEntry("Beyond-Token", "generated-token")
            .containsEntry("OPEN-SANDBOX-API-KEY", "sandbox-api-key");
    }
}
