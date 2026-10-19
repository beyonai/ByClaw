package com.iwhalecloud.byai.gateway.sandbox.recovery;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.web.server.ResponseStatusException;

class SandboxRecoveryControllerTest {
    final SandboxRecoveryStore store = mock(SandboxRecoveryStore.class);
    final SandboxRecoveryService service = mock(SandboxRecoveryService.class);
    final ByaiSystemConfigService config = mock(ByaiSystemConfigService.class);
    final SandboxRecoveryController controller = new SandboxRecoveryController(store, service, config);
    @AfterEach void clear() { CurrentUserHolder.clearLoginInfo(); }

    @ParameterizedTest
    @CsvSource({"ordinary,openSource", "ordinary,commercial", "adminvip,commercial", "adminvip,", "ordinary,"})
    void rejectsEveryEndpointUnlessBothConditionsHold(String account, String version) {
        LoginInfo user = new LoginInfo(); user.setUserCode(account); CurrentUserHolder.setLoginInfo(user);
        when(config.getDcSystemConfigValueByCode("BYAI_BRAND_VERSION")).thenReturn(version);
        assertThatThrownBy(() -> controller.queues(Map.of())).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> controller.messages(Map.of())).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(controller::history).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> controller.action(null)).isInstanceOf(ResponseStatusException.class);
        verifyNoInteractions(store, service);
    }

    @ParameterizedTest
    @CsvSource({"adminvip,openSource", "ADMINVIP,openSource"})
    void openSourceAdminVipCanReadWithoutMutatingQueue(String account, String version) {
        LoginInfo user = new LoginInfo(); user.setUserCode(account); CurrentUserHolder.setLoginInfo(user);
        when(config.getDcSystemConfigValueByCode("BYAI_BRAND_VERSION")).thenReturn(version);
        controller.queues(Map.of());
        verify(store).queues("0");
        verifyNoInteractions(service);
    }
}
