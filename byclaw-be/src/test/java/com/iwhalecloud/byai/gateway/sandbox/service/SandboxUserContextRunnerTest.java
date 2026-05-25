package com.iwhalecloud.byai.gateway.sandbox.service;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class SandboxUserContextRunnerTest {

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void callAsUser_bindsDbLoginInfoAndRestoresOriginalContext() {
        LoginApplicationService loginApplicationService = mock(LoginApplicationService.class);
        SandboxUserContextRunner runner = new SandboxUserContextRunner(loginApplicationService);

        LoginInfo dbLoginInfo = new LoginInfo();
        dbLoginInfo.setUserCode("demo-user");
        dbLoginInfo.setUserName("Demo User");
        when(loginApplicationService.getLoginInfo("demo-user")).thenReturn(dbLoginInfo);

        LoginInfo original = new LoginInfo();
        original.setUserCode("original-user");
        CurrentUserHolder.setLoginInfo(original);

        String result = runner.callAsUser("demo-user", () -> {
            assertThat(CurrentUserHolder.getLoginInfo()).isSameAs(dbLoginInfo);
            assertThat(CurrentUserHolder.getCurrentUserCode()).isEqualTo("demo-user");
            assertThat(CurrentUserHolder.getCurrentUserName()).isEqualTo("Demo User");
            return "ok";
        });

        assertThat(result).isEqualTo("ok");
        assertThat(CurrentUserHolder.getLoginInfo()).isSameAs(original);
    }

    @Test
    void callAsUser_fallsBackToUserCodeWhenLoginInfoIsMissingAndClearsAfterwards() {
        LoginApplicationService loginApplicationService = mock(LoginApplicationService.class);
        SandboxUserContextRunner runner = new SandboxUserContextRunner(loginApplicationService);

        String result = runner.callAsUser("demo-user", () -> {
            assertThat(CurrentUserHolder.getCurrentUserCode()).isEqualTo("demo-user");
            return "ok";
        });

        assertThat(result).isEqualTo("ok");
        assertThat(CurrentUserHolder.getLoginInfo()).isNull();
    }
}
