package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.manager.application.service.user.UserPrivateParamCacheReader;
import com.iwhalecloud.byai.common.constants.resource.WorkerAgentType;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class SystemParamTargetAgentResolverTest {

    @Mock
    private ByaiSystemConfigService systemConfigService;

    @Mock
    private UserPrivateParamCacheReader privateParamCacheReader;

    @Mock
    private SsResourceService ssResourceService;

    private SystemParamTargetAgentResolver resolver;

    @BeforeEach
    void setUp() {
        resolver = new SystemParamTargetAgentResolver(systemConfigService, privateParamCacheReader, ssResourceService);
    }

    @Test
    void keepsCurrentTargetWhenSystemParameterIsMissing() {
        when(systemConfigService.getDcSystemConfigValueByCode("ENABLE_DSH")).thenReturn(null);

        String result = resolver.resolve("DEFAULT_WORKER", "user-a");

        assertThat(result).isEqualTo("DEFAULT_WORKER");
        verify(systemConfigService).getDcSystemConfigValueByCode("ENABLE_DSH");
    }

    @Test
    void keepsCurrentTargetUnlessSystemParameterIsExactlyOne() {
        when(systemConfigService.getDcSystemConfigValueByCode("ENABLE_DSH")).thenReturn("true");

        assertThat(resolver.resolve("DEFAULT_WORKER", "user-a")).isEqualTo("DEFAULT_WORKER");
    }

    @Test
    void routesToUserDshWorkerWhenGloballyEnabled() {
        when(systemConfigService.getDcSystemConfigValueByCode("ENABLE_DSH")).thenReturn(" 1\n");

        assertThat(resolver.resolve("DEFAULT_WORKER", " user-a ")).isEqualTo("HARNESS_user-a");
    }

    @Test
    void personalEnableOverridesGlobalDisable() {
        when(privateParamCacheReader.getValue("user-a", "ENABLE_DSH")).thenReturn("1");

        assertThat(resolver.resolve("DEFAULT_WORKER", "user-a")).isEqualTo("HARNESS_user-a");
    }

    @Test
    void personalDisableOverridesGlobalEnable() {
        when(privateParamCacheReader.getValue("user-a", "ENABLE_DSH")).thenReturn("0");
        lenient().when(systemConfigService.getDcSystemConfigValueByCode("ENABLE_DSH")).thenReturn("1");

        assertThat(resolver.resolve("DEFAULT_WORKER", "user-a")).isEqualTo("DEFAULT_WORKER");
    }

    @Test
    void keepsCurrentTargetWhenUserCodeIsBlank() {
        assertThat(resolver.resolve("DEFAULT_WORKER", " ")).isEqualTo("DEFAULT_WORKER");
    }

    @Test
    void routesHarnessEmployeeToDshWhenUserOverrideIsNotEnabled() {
        SsResource resource = new SsResource();
        resource.setWorkerAgentType(WorkerAgentType.HARNESS.getCode());
        when(ssResourceService.findById(100L)).thenReturn(resource);

        assertThat(resolver.resolve("HARNESS", 100L, "user-a")).isEqualTo("HARNESS_user-a");
    }

    @Test
    void personalDshEnableTakesPriorityOverEmployeeType() {
        when(privateParamCacheReader.getValue("user-a", "ENABLE_DSH")).thenReturn("1");

        assertThat(resolver.resolve("BYCLAW_EXE_user-a", 100L, "user-a")).isEqualTo("HARNESS_user-a");
    }
}
