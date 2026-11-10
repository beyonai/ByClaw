package com.iwhalecloud.byai.gateway.sandbox.shared;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class SharedSandboxPolicyTest {
    @Mock
    private ByaiSystemConfigService byaiSystemConfigService;

    @InjectMocks
    private SharedSandboxPolicy policy;

    @Test
    void jsonMapsToPolicyObjectFields() {
        SharedSandboxPolicyConfig policy = com.alibaba.fastjson.JSON.parseObject(
            "{\"defaultMode\":\"shared\",\"excludedUsers\":[\"adminvip\",\"zte\"]}", SharedSandboxPolicyConfig.class);
        assertThat(policy.getDefaultMode()).isEqualTo(SharedSandboxPolicyConfig.SHARED);
        assertThat(policy.getExcludedUsers()).containsExactlyInAnyOrder("adminvip", "zte");
    }

    @Test
    void policyIsParsedAndRereadOnEveryDecision() {
        assertThat(policy.eligible("alice")).isFalse();
        when(byaiSystemConfigService.getDcSystemConfigValueByCode(SharedSandboxPolicy.POLICY))
            .thenReturn("{\"defaultMode\":\"shared\",\"excludedUsers\":[\" alice \",\"alice\",\"bob\"]}");
        assertThat(policy.eligible("alice")).isFalse();
        assertThat(policy.eligible(" bob ")).isFalse();
        assertThat(policy.eligible("ali")).isTrue();
        assertThat(policy.eligible("Alice")).isTrue();
        assertThat(policy.eligible(" ")).isFalse();
        when(byaiSystemConfigService.getDcSystemConfigValueByCode(SharedSandboxPolicy.POLICY))
            .thenReturn("{\"defaultMode\":\"exclusive\",\"excludedUsers\":[\"alice\"]}");
        assertThat(policy.eligible("alice")).isFalse();
        assertThat(policy.eligible("charlie")).isFalse();
    }

    @Test
    void emptyPolicyAndEmptyExclusionsHaveDifferentDefaults() {
        when(byaiSystemConfigService.getDcSystemConfigValueByCode(SharedSandboxPolicy.POLICY))
            .thenReturn("{\"defaultMode\":\"shared\"}");
        assertThat(policy.eligible("alice")).isTrue();
        when(byaiSystemConfigService.getDcSystemConfigValueByCode(SharedSandboxPolicy.POLICY)).thenReturn(" ");
        assertThat(policy.eligible("alice")).isFalse();
        when(byaiSystemConfigService.getDcSystemConfigValueByCode(SharedSandboxPolicy.POLICY))
            .thenReturn("{\"defaultMode\":\"shared\",\"excludedUsers\":[]}");
        assertThat(policy.eligible("alice")).isTrue();
    }

    @Test
    void missingOrInvalidPolicyDoesNotGrantSharedAccess() {
        for (String value : new String[] {"broken", "null", "[]", "{}",
            "{\"defaultMode\":\"other\",\"excludedUsers\":[]}",
            "{\"defaultMode\":\"shared\",\"excludedUsers\":null}"}) {
            when(byaiSystemConfigService.getDcSystemConfigValueByCode(SharedSandboxPolicy.POLICY)).thenReturn(value);
            assertThat(policy.eligible("alice")).isFalse();
        }
    }

    @Test
    void unreadablePolicyReturnsFalse() {
        when(byaiSystemConfigService.getDcSystemConfigValueByCode(SharedSandboxPolicy.POLICY))
            .thenThrow(new IllegalStateException("unavailable"));
        assertThat(policy.eligible("alice")).isFalse();
    }

    @Test
    void nasAndTenantSwitchesRemainIndependent() {
        assertThat(policy.userNasEnabled("alice", "byclaw-dsh")).isFalse();
        when(byaiSystemConfigService.getDcSystemConfigValueByCode(SharedSandboxPolicy.USER_NAS)).thenReturn("1");
        when(byaiSystemConfigService.getDcSystemConfigValueByCode(SharedSandboxPolicy.POLICY))
            .thenReturn("{\"defaultMode\":\"shared\",\"excludedUsers\":[\"bob\"]}");
        assertThat(policy.userNasEnabled("alice", "byclaw-dsh")).isTrue();
        assertThat(policy.userNasEnabled("bob", "byclaw-dsh")).isFalse();
        assertThat(policy.userNasEnabled("alice", "openclaw")).isFalse();
        assertThat(policy.byTenant()).isFalse();
        when(byaiSystemConfigService.getDcSystemConfigValueByCode(SharedSandboxPolicy.BY_TENANT)).thenReturn("1");
        assertThat(policy.byTenant()).isTrue();
    }
}
