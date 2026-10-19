package com.iwhalecloud.byai.gateway.sandbox.recovery;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import java.util.Map;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import org.junit.jupiter.api.*;
import org.springframework.web.server.ResponseStatusException;

class SandboxRecoveryControllerTest {
    final SandboxRecoveryStore store = mock(SandboxRecoveryStore.class);
    final SandboxRecoveryService service = mock(SandboxRecoveryService.class);
    final ByaiSystemConfigService config = mock(ByaiSystemConfigService.class);
    final SandboxRecoveryController controller = new SandboxRecoveryController(store, service, config);
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"PLAT_MAN", "PLAT_DEVOPS"})
    void commercialPlatformRolesCannotRead(String role) {
        LoginInfo user = new LoginInfo(); user.setUserCode("platform-user");
        com.iwhalecloud.byai.common.login.bean.UsersOrganization organization = new com.iwhalecloud.byai.common.login.bean.UsersOrganization();
        organization.setUserType(role); user.setUsersOrganizations(java.util.List.of(organization));
        CurrentUserHolder.setLoginInfo(user);
        when(config.getDcSystemConfigValueByCode("BYAI_BRAND_VERSION")).thenReturn("commercial");
        assertThatThrownBy(controller::history).isInstanceOf(ResponseStatusException.class);
        verifyNoInteractions(store, service);
    }
    @Test void openSourceAllowsRead() {
        LoginInfo user = new LoginInfo(); user.setUserCode("ordinary"); CurrentUserHolder.setLoginInfo(user);
        when(config.getDcSystemConfigValueByCode("BYAI_BRAND_VERSION")).thenReturn("openSource");
        controller.queues(Map.of());
        verify(store).queues("0");
    }
    @Test void missingVersionDoesNotGrantAccess() {
        LoginInfo user = new LoginInfo(); user.setUserCode("ordinary"); CurrentUserHolder.setLoginInfo(user);
        assertThatThrownBy(controller::history).isInstanceOf(ResponseStatusException.class);
        verifyNoInteractions(store, service);
    }
    @AfterEach void clear() { CurrentUserHolder.clearLoginInfo(); }
    @Test void allEndpointsRejectOrdinaryUsers() {
        when(config.getDcSystemConfigValueByCode("BYAI_BRAND_VERSION")).thenReturn("commercial");
        LoginInfo user = new LoginInfo(); user.setUserCode("ordinary"); CurrentUserHolder.setLoginInfo(user);
        assertThatThrownBy(() -> controller.queues(Map.of())).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> controller.messages(Map.of())).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(controller::history).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> controller.action(null)).isInstanceOf(ResponseStatusException.class);
        verifyNoInteractions(store, service);
    }
    @Test void adminVipCanReadWithoutMutatingQueue() {
        LoginInfo user = new LoginInfo(); user.setUserCode("adminvip"); CurrentUserHolder.setLoginInfo(user);
        controller.queues(Map.of());
        verify(store).queues("0");
        verifyNoInteractions(service);
    }
}
