package com.iwhalecloud.byai.gateway.sandbox.shared;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import org.junit.jupiter.api.Test;

class SharedSandboxPolicyTest {
    @Test
    void exactWhitelistAndAllSwitchAreIndependentOfPoolScope() {
        var config = mock(ByaiSystemConfigService.class);
        var policy = new SharedSandboxPolicy(config);
        assertThat(policy.eligible("alice")).isFalse();
        when(config.getDcSystemConfigValueByCode("BYCLAW_SHARED_DSH_HOST_USERS")).thenReturn("alice; alice bob");
        assertThat(policy.eligible("alice")).isTrue();
        assertThat(policy.eligible("ali")).isFalse();
        assertThat(policy.byTenant()).isFalse();
        when(config.getDcSystemConfigValueByCode("BYCLAW_SANDBOX_SHARED_BY_TENANT")).thenReturn("1");
        assertThat(policy.byTenant()).isTrue();
        assertThat(policy.eligible("charlie")).isFalse();
        when(config.getDcSystemConfigValueByCode("BYCLAW_SANDBOX_SHARED_ALL")).thenReturn("1");
        assertThat(policy.eligible("charlie")).isTrue();
        assertThat(policy.eligible(" ")).isFalse();
    }

    @Test
    void wildcardAndInvalidSwitchDoNotAdmitEveryone() {
        var config = mock(ByaiSystemConfigService.class);
        var policy = new SharedSandboxPolicy(config);
        when(config.getDcSystemConfigValueByCode("BYCLAW_SHARED_DSH_HOST_USERS")).thenReturn("*");
        when(config.getDcSystemConfigValueByCode("BYCLAW_SANDBOX_SHARED_ALL")).thenReturn("true");
        assertThat(policy.eligible("alice")).isFalse();
    }

    @Test
    void unreadablePolicyDoesNotSilentlyAllocateAnExclusiveSandbox() {
        var config = mock(ByaiSystemConfigService.class);
        var policy = new SharedSandboxPolicy(config);
        when(config.getDcSystemConfigValueByCode("BYCLAW_SANDBOX_SHARED_ALL"))
            .thenThrow(new IllegalStateException("unavailable"));
        assertThatThrownBy(() -> policy.eligible("alice")).hasMessageContaining("共享沙箱入口配置读取失败");
    }
}
