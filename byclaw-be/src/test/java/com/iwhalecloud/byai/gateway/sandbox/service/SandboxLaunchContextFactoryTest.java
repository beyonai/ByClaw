package com.iwhalecloud.byai.gateway.sandbox.service;

import com.iwhalecloud.byai.common.i18n.I18nTestSupport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.lenient;
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

import com.iwhalecloud.byai.common.discovery.ApplicationServiceEndpoint;
import com.iwhalecloud.byai.common.feign.response.knowledge.ModelDto;
import com.iwhalecloud.byai.manager.application.service.aimodel.ModelManagementApplicationService;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AiModelService;
import com.iwhalecloud.byai.manager.domain.aimodel.service.ModelConfigurationValidator;
import com.iwhalecloud.byai.common.constants.resource.WorkerAgentType;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpec;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpecRepository;
import com.iwhalecloud.byai.manager.application.service.devloop.GitHubCredentialResolver;
import com.iwhalecloud.byai.manager.application.service.user.UserPrivateParamApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;

@ExtendWith(MockitoExtension.class)
class SandboxLaunchContextFactoryTest extends I18nTestSupport {

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

    @Mock
    private ApplicationServiceEndpoint applicationServiceEndpoint;

    @Mock
    private SsResourceService ssResourceService;

    @Mock
    private AiModelService aiModelService;

    @Mock
    private ModelManagementApplicationService modelManagementApplicationService;

    @Test
    void invalidModelStopsLaunchInsteadOfInjectingPlaceholderCredentials() {
        when(modelManagementApplicationService.getDefaultModelId()).thenReturn("42");
        ModelDto model = new ModelDto();
        model.setModelCode("test-model");
        model.setUrl("https://example.com/v1");
        model.setAuthToken("请用户替换");
        when(aiModelService.getModel("42")).thenReturn(model);
        assertThatThrownBy(() -> factory.buildContext("user001", -1L, "openclaw"))
            .isInstanceOf(ModelConfigurationValidator.InvalidModelConfigurationException.class)
            .hasMessageContaining("模型管理");
    }

    @BeforeEach
    void setUp() {
        lenient().when(stringRedisTemplate.opsForValue()).thenReturn(valueOperations);
        lenient().when(applicationServiceEndpoint.getBaseUrl()).thenReturn("http://192.168.0.83:8086/byaiService");
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
            .containsEntry("BYAI_SERVICE_BASE_URL", "http://192.168.0.83:8086/byaiService")
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

    @Test
    void resolveRoutingRoutesHarnessWorkerAgentTypeByPrefix() {
        SsResource resource = new SsResource();
        resource.setWorkerAgentType(WorkerAgentType.HARNESS.getCode() + "_user001");
        when(ssResourceService.findById(105L)).thenReturn(resource);

        assertThat(factory.resolveRouting(105L).getSandboxType())
            .isEqualTo(SandboxLaunchRouting.BYCLAW_DSH_SANDBOX_TYPE);
    }
}
