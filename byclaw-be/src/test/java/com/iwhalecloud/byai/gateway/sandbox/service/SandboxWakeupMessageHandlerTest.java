package com.iwhalecloud.byai.gateway.sandbox.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.doAnswer;

import java.util.Map;

import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;

class SandboxWakeupMessageHandlerTest {

    @Test
    void handle_wakesDefaultSandboxForWakeAndWaitTarget() {
        SandboxService sandboxService = mock(SandboxService.class);
        SandboxWakeupMessageHandler handler = new SandboxWakeupMessageHandler(sandboxService);

        boolean handled = handler.handle(Map.of(
            "policy", "WAKE_AND_WAIT",
            "target_agent_type", "BYCLAW_EXE_demo-user",
            "user_code", "demo-user",
            "execution_id", "exec-1"
        ));

        assertThat(handled).isTrue();
        verify(sandboxService).restartSandboxAfterRemoteExit("demo-user", SandboxLaunchRouting.DEFAULT_RESOURCE_ID,
            "BYCLAW_EXE_demo-user");
    }

    @Test
    void handle_wakesFromJsonDataField() {
        SandboxService sandboxService = mock(SandboxService.class);
        SandboxWakeupMessageHandler handler = new SandboxWakeupMessageHandler(sandboxService);

        boolean handled = handler.handle(Map.of("data", """
            {
              "policy": "WAKE_AND_WAIT",
              "target_agent_type": "BYCLAW_EXE_demo-user",
              "user_code": "demo-user"
            }
            """));

        assertThat(handled).isTrue();
        verify(sandboxService).restartSandboxAfterRemoteExit("demo-user", SandboxLaunchRouting.DEFAULT_RESOURCE_ID,
            "BYCLAW_EXE_demo-user");
    }

    @Test
    void handle_resolvesUserCodeFromTargetWhenMissing() {
        SandboxService sandboxService = mock(SandboxService.class);
        SandboxWakeupMessageHandler handler = new SandboxWakeupMessageHandler(sandboxService);

        boolean handled = handler.handle(Map.of(
            "policy", "WAKE_AND_WAIT",
            "target_agent_type", "BYCLAW_EXE_demo-user"
        ));

        assertThat(handled).isTrue();
        verify(sandboxService).restartSandboxAfterRemoteExit("demo-user", SandboxLaunchRouting.DEFAULT_RESOURCE_ID,
            "BYCLAW_EXE_demo-user");
    }

    @Test
    void handle_ignoresNonWakeAndWaitPolicy() {
        SandboxService sandboxService = mock(SandboxService.class);
        SandboxWakeupMessageHandler handler = new SandboxWakeupMessageHandler(sandboxService);

        boolean handled = handler.handle(Map.of(
            "policy", "DIRECT",
            "target_agent_type", "BYCLAW_EXE_demo-user",
            "user_code", "demo-user"
        ));

        assertThat(handled).isFalse();
        verify(sandboxService, never()).restartSandboxAfterRemoteExit("demo-user",
            SandboxLaunchRouting.DEFAULT_RESOURCE_ID, "BYCLAW_EXE_demo-user");
    }

    @Test
    void handle_ignoresDifferentTarget() {
        SandboxService sandboxService = mock(SandboxService.class);
        SandboxWakeupMessageHandler handler = new SandboxWakeupMessageHandler(sandboxService);

        boolean handled = handler.handle(Map.of(
            "policy", "WAKE_AND_WAIT",
            "target_agent_type", "BYCLAW_CODE_demo-user",
            "user_code", "demo-user"
        ));

        assertThat(handled).isFalse();
        verify(sandboxService, never()).restartSandboxAfterRemoteExit("demo-user",
            SandboxLaunchRouting.DEFAULT_RESOURCE_ID, "BYCLAW_CODE_demo-user");
    }

    @Test
    void handle_setsWakeupUserContextDuringSandboxRestartAndClearsAfterwards() {
        CurrentUserHolder.clearLoginInfo();
        SandboxService sandboxService = mock(SandboxService.class);
        doAnswer(invocation -> {
            assertThat(CurrentUserHolder.getCurrentUserCode()).isEqualTo("demo-user");
            assertThat(CurrentUserHolder.getCurrentUserName()).isNull();
            assertThat(CurrentUserHolder.getSessionId()).isNull();
            return null;
        }).when(sandboxService).restartSandboxAfterRemoteExit("demo-user", SandboxLaunchRouting.DEFAULT_RESOURCE_ID,
            "BYCLAW_EXE_demo-user");
        SandboxWakeupMessageHandler handler = new SandboxWakeupMessageHandler(sandboxService);

        boolean handled = handler.handle(Map.of(
            "policy", "WAKE_AND_WAIT",
            "target_agent_type", "BYCLAW_EXE_demo-user",
            "user_code", "demo-user",
            "session_id", "session-1"
        ));

        assertThat(handled).isTrue();
        assertThat(CurrentUserHolder.getLoginInfo()).isNull();
    }

    @Test
    void handle_restoresExistingUserContextAfterSandboxRestart() {
        LoginInfo original = new LoginInfo();
        original.setUserCode("original-user");
        CurrentUserHolder.setLoginInfo(original);
        SandboxService sandboxService = mock(SandboxService.class);
        SandboxWakeupMessageHandler handler = new SandboxWakeupMessageHandler(sandboxService);

        boolean handled = handler.handle(Map.of(
            "policy", "WAKE_AND_WAIT",
            "target_agent_type", "BYCLAW_EXE_demo-user",
            "user_code", "demo-user"
        ));

        assertThat(handled).isTrue();
        assertThat(CurrentUserHolder.getLoginInfo()).isSameAs(original);
        CurrentUserHolder.clearLoginInfo();
    }
}
