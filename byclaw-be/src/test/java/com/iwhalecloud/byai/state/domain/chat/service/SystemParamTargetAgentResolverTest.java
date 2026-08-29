package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.manager.application.service.user.UserPrivateParamCacheReader;
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

    private SystemParamTargetAgentResolver resolver;

    @BeforeEach
    void setUp() {
        resolver = new SystemParamTargetAgentResolver(systemConfigService, privateParamCacheReader,
            "ENABLE_EXTERNAL_WORKER", "EXTERNAL_{userCode}");
    }

    @Test
    void keepsCurrentTargetWhenSystemParameterIsMissing() {
        when(systemConfigService.getDcSystemConfigValueByCode("ENABLE_EXTERNAL_WORKER")).thenReturn(null);

        String result = resolver.resolve("DEFAULT_WORKER", "user-a");

        assertThat(result).isEqualTo("DEFAULT_WORKER");
        verify(systemConfigService).getDcSystemConfigValueByCode("ENABLE_EXTERNAL_WORKER");
    }

    @Test
    void keepsCurrentTargetUnlessSystemParameterIsExactlyOne() {
        when(systemConfigService.getDcSystemConfigValueByCode("ENABLE_EXTERNAL_WORKER")).thenReturn("true");

        assertThat(resolver.resolve("DEFAULT_WORKER", "user-a")).isEqualTo("DEFAULT_WORKER");
    }

    @Test
    void expandsUserCodeInConfiguredTargetTemplateWhenEnabled() {
        when(systemConfigService.getDcSystemConfigValueByCode("ENABLE_EXTERNAL_WORKER")).thenReturn(" 1\n");

        assertThat(resolver.resolve("DEFAULT_WORKER", " user-a ")).isEqualTo("EXTERNAL_user-a");
    }

    @Test
    void personalEnableOverridesGlobalDisable() {
        when(privateParamCacheReader.getValue("user-a", "ENABLE_EXTERNAL_WORKER")).thenReturn("1");

        assertThat(resolver.resolve("DEFAULT_WORKER", "user-a")).isEqualTo("EXTERNAL_user-a");
    }

    @Test
    void personalDisableOverridesGlobalEnable() {
        when(privateParamCacheReader.getValue("user-a", "ENABLE_EXTERNAL_WORKER")).thenReturn("0");
        lenient().when(systemConfigService.getDcSystemConfigValueByCode("ENABLE_EXTERNAL_WORKER")).thenReturn("1");

        assertThat(resolver.resolve("DEFAULT_WORKER", "user-a")).isEqualTo("DEFAULT_WORKER");
    }

    @Test
    void keepsCurrentTargetWhenConfigurationOrUserCodeIsBlank() {
        assertThat(new SystemParamTargetAgentResolver(systemConfigService, privateParamCacheReader,
            "", "EXTERNAL_{userCode}")
            .resolve("DEFAULT_WORKER", "user-a")).isEqualTo("DEFAULT_WORKER");
        assertThat(new SystemParamTargetAgentResolver(systemConfigService, privateParamCacheReader,
            "ENABLE_EXTERNAL_WORKER", "")
            .resolve("DEFAULT_WORKER", "user-a")).isEqualTo("DEFAULT_WORKER");
        assertThat(resolver.resolve("DEFAULT_WORKER", " ")).isEqualTo("DEFAULT_WORKER");
    }
}
