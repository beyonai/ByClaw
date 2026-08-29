package com.iwhalecloud.byai.gateway.sandbox.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import java.util.Map;
import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpec;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpecRepository;
import com.iwhalecloud.byai.manager.application.service.devloop.GitHubCredentialResolver;
import com.iwhalecloud.byai.manager.application.service.user.UserPrivateParamApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;

@ExtendWith(MockitoExtension.class)
class SandboxLaunchContextFactoryTest {

    @InjectMocks
    private SandboxLaunchContextFactory factory;

    @Mock
    private SsResExtDigEmployeeService ssResExtDigEmployeeService;

    @Mock
    private SandboxServiceSpecRepository sandboxServiceSpecRepository;

    @Mock
    private ByaiSystemConfigService byaiSystemConfigService;

    @Mock
    private SandboxUserInfoFactory sandboxUserInfoFactory;

    @Mock
    private StringRedisTemplate stringRedisTemplate;

    @Mock
    private ValueOperations<String, String> valueOperations;

    @Mock
    private GitHubCredentialResolver githubCredentialResolver;

    @BeforeEach
    void setUp() {
        when(stringRedisTemplate.opsForValue()).thenReturn(valueOperations);
    }

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
            .containsEntry("OPENCLAW_GATEWAY_TOKEN", first.getGatewayToken())
            .containsEntry("USER_CODE", "user001")
            .doesNotContainKey("BYCLAW_USER_CODE");
    }

    @Test
    void buildContextDoesNotInjectAnImaCredentialHome() {
        SandboxLaunchContext context = factory.buildContext("user001", 101L,
            SandboxLaunchRouting.DEFAULT_SANDBOX_TYPE);

        assertThat(context.getEnvs()).doesNotContainKey("IMA_HOME");
    }

    @Test
    void buildContextLoadsSystemConfigOnlyForSpecEnvKeys() {
        SandboxServiceSpec spec = new SandboxServiceSpec();
        spec.setEnv(Map.of("WEB_BASE_URL", "${WEB_BASE_URL}", "TZ", "Asia/Shanghai"));
        when(sandboxServiceSpecRepository.findByServiceKey("openclaw")).thenReturn(Optional.of(spec));
        when(byaiSystemConfigService.getDcSystemConfigValuesByCodes(spec.getEnv().keySet()))
            .thenReturn(Map.of("WEB_BASE_URL", "https://web.example"));

        SandboxLaunchContext context = factory.buildContext("user001", 102L, "openclaw");

        assertThat(context.getEnvs()).containsEntry("WEB_BASE_URL", "https://web.example")
            .doesNotContainKey("TZ");
    }

    @Test
    void buildContextPrefersConnectorTokenOverLegacyPersonalToken() {
        String redisKey = UserPrivateParamApplicationService.buildPrivateParamRedisKey("user001");
        when(valueOperations.get(redisKey)).thenReturn("{\"params\":{\"GH_TOKEN\":\"legacy-token\"}}");
        when(githubCredentialResolver.resolveByUserCode("user001")).thenReturn("connector-token");

        SandboxLaunchContext context = factory.buildContext("user001", 103L,
            SandboxLaunchRouting.DEFAULT_SANDBOX_TYPE);

        assertThat(context.getEnvs()).containsEntry("GH_TOKEN", "connector-token");
    }

    @Test
    void buildContextKeepsLegacyPersonalTokenWhenResolverReturnsNoToken() {
        String redisKey = UserPrivateParamApplicationService.buildPrivateParamRedisKey("user001");
        when(valueOperations.get(redisKey)).thenReturn("{\"params\":{\"GH_TOKEN\":\"legacy-token\"}}");

        SandboxLaunchContext context = factory.buildContext("user001", 104L,
            SandboxLaunchRouting.DEFAULT_SANDBOX_TYPE);

        assertThat(context.getEnvs()).containsEntry("GH_TOKEN", "legacy-token");
    }
}
