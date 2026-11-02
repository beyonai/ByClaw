package com.iwhalecloud.byai.gateway.sandbox.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

import com.iwhalecloud.byai.common.constants.users.UserType;
import com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.login.bean.UsersOrganization;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxUserContextRunner;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;

class ToolEnvironmentBootstrapAuthorizationTest {
    private final SandboxService service = mock(SandboxService.class);
    private final LoginApplicationService loginService = mock(LoginApplicationService.class);
    private final SandboxController controller = new SandboxController();

    ToolEnvironmentBootstrapAuthorizationTest() {
        ReflectionTestUtils.setField(controller, "sandboxService", service);
        ReflectionTestUtils.setField(controller, "sandboxUserContextRunner", new SandboxUserContextRunner(loginService));
    }

    @AfterEach void clearIdentity() { CurrentUserHolder.clearLoginInfo(); }

    @Test void ordinaryCallerCannotInjectKeysIntoAnotherUsersSandbox() {
        LoginInfo caller = login("caller", UserType.ORD_USER);
        assertDenied("target", HttpStatus.FORBIDDEN);
        assertThat(CurrentUserHolder.getLoginInfo()).isSameAs(caller);
        verifyNoInteractions(loginService, service);
    }

    @Test void businessAdministratorCannotImpersonateAnotherUserForKeyInjection() {
        login("business-admin", UserType.BUSINESS_MAN);
        assertDenied("target", HttpStatus.FORBIDDEN);
        verifyNoInteractions(loginService, service);
    }

    @Test void anonymousCallerIsRejectedBeforeTargetLookupOrKeyParsing() {
        CurrentUserHolder.clearLoginInfo();
        assertThatThrownBy(() -> controller.launchByUserCode(Map.of("userCode", "target",
            "toolEnvironmentKeys", Map.of("private-value", "never-echo"))))
            .isInstanceOfSatisfying(ResponseStatusException.class,
                error -> assertThat(error.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED));
        verifyNoInteractions(loginService, service);
    }

    @Test void ownerCanLaunchWithRequestScopedKeysAndKeepsOriginalIdentity() {
        LoginInfo caller = login("owner", UserType.ORD_USER);
        assertAllowed("owner");
        assertThat(CurrentUserHolder.getLoginInfo()).isSameAs(caller);
    }

    @Test void platformAdministratorAndOperatorMayManageAnotherUsersToolSandbox() {
        for (String role : List.of(UserType.PLAT_MAN, UserType.PLAT_DEVOPS)) {
            LoginInfo caller = login("platform-operator", role);
            assertAllowed("target");
            assertThat(CurrentUserHolder.getLoginInfo()).isSameAs(caller);
        }
    }

    private void assertDenied(String target, HttpStatus status) {
        assertThatThrownBy(() -> controller.launchByUserCode(request(target)))
            .isInstanceOfSatisfying(ResponseStatusException.class,
                error -> assertThat(error.getStatusCode()).isEqualTo(status));
    }

    private void assertAllowed(String target) {
        SandboxLaunchData data = new SandboxLaunchData();
        data.setSandboxId("owned-tool-instance");
        when(service.launchSandboxWithServiceKey(target, "byclaw-tools-browser", null, keys())).thenReturn(data);
        assertThat(controller.launchByUserCode(request(target)).getCode()).isEqualTo(ResponseUtil.SUCCESS);
        verify(service, atLeastOnce()).launchSandboxWithServiceKey(target, "byclaw-tools-browser", null, keys());
    }

    private Map<String, Object> request(String target) {
        return Map.of("userCode", target, "serviceKey", "byclaw-tools-browser", "toolEnvironmentKeys", keys());
    }

    private Map<String, String> keys() {
        return Map.of("authorizedKey", "ssh-ed25519 Zml4dHVyZQ== fixture", "hostPrivateKeyBase64",
            Base64.getEncoder().encodeToString(("-----BEGIN OPENSSH PRIVATE KEY-----\nfixture\n"
                + "-----END OPENSSH PRIVATE KEY-----\n").getBytes(StandardCharsets.UTF_8)));
    }

    private LoginInfo login(String code, String role) {
        LoginInfo info = new LoginInfo();
        info.setUserCode(code);
        UsersOrganization organization = new UsersOrganization();
        organization.setUserType(role);
        info.setUsersOrganizations(List.of(organization));
        CurrentUserHolder.setLoginInfo(info);
        return info;
    }
}
