package com.iwhalecloud.byai.gateway.sandbox.service;

import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpec;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpecRepository;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class SandboxAutoStartEligibilityTest {
    @Test
    void effectivePolicyExcludesDisabledOnDemandTenantSharedAndFileServices() {
        SandboxService service = mock(SandboxService.class, CALLS_REAL_METHODS);
        SandboxServiceSpecRepository repository = mock(SandboxServiceSpecRepository.class);
        ReflectionTestUtils.setField(service, "sandboxServiceSpecRepository", repository);
        SandboxServiceSpec spec = new SandboxServiceSpec();
        spec.setOwnerScope("USER");
        when(repository.findByServiceKeyAndProfile("byclaw-dsh-tools", null)).thenReturn(Optional.of(spec));
        assertThat(service.isServiceKeyAutoStartEnabled("byclaw-dsh-tools")).isTrue();
        spec.setRuntimeOptions(Map.of("lifecycle", Map.of("autoStart", "false")));
        assertThat(service.isServiceKeyAutoStartEnabled("byclaw-dsh-tools")).isFalse();
        spec.setRuntimeOptions(null);
        for (String scope : new String[] {"TENANT", "SHARED"}) {
            spec.setOwnerScope(scope);
            assertThat(service.isServiceKeyAutoStartEnabled("byclaw-dsh-tools")).isFalse();
        }
        spec.setOwnerScope("USER");
        spec.setRuntimeOptions(Map.of("fileService", Map.of("mountDir", "/fixture")));
        assertThat(service.isServiceKeyAutoStartEnabled("byclaw-dsh-tools")).isFalse();
        when(repository.findByServiceKeyAndProfile("byclaw-dsh-tools", null)).thenReturn(Optional.empty());
        assertThat(service.isServiceKeyAutoStartEnabled("byclaw-dsh-tools")).isFalse();
    }

    @Test
    void preferenceEligibilityUsesTheEffectiveProfilePolicy() {
        SandboxService service = mock(SandboxService.class, CALLS_REAL_METHODS);
        SandboxServiceSpecRepository repository = mock(SandboxServiceSpecRepository.class);
        ReflectionTestUtils.setField(service, "sandboxServiceSpecRepository", repository);
        SandboxServiceSpec spec = new SandboxServiceSpec();
        spec.setOwnerScope("USER");
        spec.setRuntimeOptions(Map.of("lifecycle", Map.of("autoStart", "false")));
        when(repository.findByServiceKeyAndProfile("openclaw", "xs")).thenReturn(Optional.of(spec));
        assertThat(service.isServiceKeyAutoStartEnabled("openclaw-xs")).isFalse();
        verify(repository).findByServiceKeyAndProfile("openclaw", "xs");
    }
}
