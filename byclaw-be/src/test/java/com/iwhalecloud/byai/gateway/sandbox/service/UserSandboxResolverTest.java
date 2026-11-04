package com.iwhalecloud.byai.gateway.sandbox.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

import java.util.Date;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

import com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData;

class UserSandboxResolverTest {

    private final SandboxLifecycleFacade lifecycle = mock(SandboxLifecycleFacade.class);
    private final SandboxService sandboxes = mock(SandboxService.class);
    private final UserSandboxResolver resolver = new UserSandboxResolver(lifecycle, sandboxes);

    @Test
    void resolvesTheUsersSelectedExecutionEnvironmentWithoutScanningOtherServices() {
        SandboxLaunchData launched = new SandboxLaunchData();
        launched.setSandboxId("selected-execution-instance");
        Date expiresAt = new Date(1800000000000L);
        launched.setRemoteExpiresAt(expiresAt);
        when(sandboxes.launchUserExecutionSandbox("user-a")).thenReturn(launched);

        UserSandboxResolver.UserSandboxContext result = resolver.resolve("user-a");

        assertThat(result.sandboxId()).isEqualTo("selected-execution-instance");
        assertThat(result.userCode()).isEqualTo("user-a");
        assertThat(result.expiresAt()).isEqualTo(expiresAt);
        verify(sandboxes).launchUserExecutionSandbox("user-a");
        verifyNoMoreInteractions(sandboxes);
        verifyNoInteractions(lifecycle);
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = " ")
    void rejectsMissingUserBeforeResolvingAnEnvironment(String userCode) {
        assertThatThrownBy(() -> resolver.resolve(userCode)).isInstanceOf(IllegalArgumentException.class);

        verifyNoInteractions(lifecycle, sandboxes);
    }

    @Test
    void propagatesRoutingFailureWithoutFallingBackToAnotherService() {
        IllegalStateException unavailable = new IllegalStateException("Selected execution environment unavailable");
        when(sandboxes.launchUserExecutionSandbox("user-a")).thenThrow(unavailable);

        assertThatThrownBy(() -> resolver.resolve("user-a")).isSameAs(unavailable);

        verify(sandboxes).launchUserExecutionSandbox("user-a");
        verifyNoMoreInteractions(sandboxes);
        verifyNoInteractions(lifecycle);
    }

    @Test
    void rejectsAMissingLaunchResult() {
        assertThatThrownBy(() -> resolver.resolve("user-a")).isInstanceOf(IllegalStateException.class)
            .hasMessage("Unable to resolve user execution sandbox");
        verifyNoInteractions(lifecycle);
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = " ")
    void rejectsLaunchResultsWithoutAnExecutionInstance(String sandboxId) {
        SandboxLaunchData launched = new SandboxLaunchData();
        launched.setSandboxId(sandboxId);
        when(sandboxes.launchUserExecutionSandbox("user-a")).thenReturn(launched);

        assertThatThrownBy(() -> resolver.resolve("user-a")).isInstanceOf(IllegalStateException.class)
            .hasMessage("Unable to resolve user execution sandbox");
        verifyNoInteractions(lifecycle);
    }
}
