package com.iwhalecloud.byai.gateway.sandbox.shared;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.util.Map;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class SharedSandboxControllerTest {
    private final SharedSandboxGateway gateway = mock(SharedSandboxGateway.class);
    private final SharedSandboxController controller = new SharedSandboxController(gateway);

    @Test
    void ordinaryUserCannotReadOrMutateAdminResources() {
        try (var current = mockStatic(CurrentUserHolder.class)) {
            for (String operation : new String[] {"listRecords", "listMembers", "listConfigs", "saveConfig", "releaseInstance"}) {
                assertThatThrownBy(() -> controller.call(operation, Map.of()))
                    .isInstanceOfSatisfying(ResponseStatusException.class, e -> assertThat(e.getStatusCode().value()).isEqualTo(403));
            }
            verifyNoInteractions(gateway);
        }
    }

    @Test
    void businessAdminCannotForgeAnotherTenantOrPlatformPrivileges() {
        try (var current = mockStatic(CurrentUserHolder.class)) {
            current.when(CurrentUserHolder::isBusinessAdmin).thenReturn(true);
            current.when(CurrentUserHolder::getEnterpriseId).thenReturn(7L);
            current.when(CurrentUserHolder::getCurrentUserCode).thenReturn("alice");
            controller.call("listMembers", Map.of("tenantScope", 9L, "enterpriseId", 9L,
                "platformManager", true, "userInfo", Map.of("userCode", "root")));
            verify(gateway).call(eq("listMembers"), argThat(p -> Long.valueOf(7).equals(p.get("tenantScope"))
                && Long.valueOf(7).equals(p.get("enterpriseId")) && Boolean.FALSE.equals(p.get("platformManager"))
                && !p.containsKey("userInfo") && "alice".equals(p.get("operatorUserCode"))));
            assertThatThrownBy(() -> controller.call("releaseInstance", Map.of()))
                .isInstanceOf(ResponseStatusException.class);
        }
    }

    @Test
    void platformAdminCanConfigureButCannotExposeAllocationThroughManagerProxy() {
        try (var current = mockStatic(CurrentUserHolder.class)) {
            current.when(CurrentUserHolder::isPlatformManager).thenReturn(true);
            controller.call("saveConfig", Map.of("serviceKey", "custom-host", "maxOnlineUsers", 10));
            verify(gateway).call(eq("saveConfig"), argThat(p -> "custom-host".equals(p.get("serviceKey"))));
            assertThatThrownBy(() -> controller.call("acquire", Map.of()))
                .isInstanceOfSatisfying(ResponseStatusException.class, e -> assertThat(e.getStatusCode().value()).isEqualTo(404));
        }
    }
}
