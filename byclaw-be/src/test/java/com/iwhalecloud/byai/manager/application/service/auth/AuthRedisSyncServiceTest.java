package com.iwhalecloud.byai.manager.application.service.auth;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.manager.domain.event.user.UserOrganizationChangedEvent;

class AuthRedisSyncServiceTest {

    @Test
    void handleUserOrganizationChanged_rebuildsAffectedUserPermissions() {
        AuthRedisSyncService service = new AuthRedisSyncService();
        AuthApplicationService authApplicationService = mock(AuthApplicationService.class);
        AuthRedisApplicationService authRedisApplicationService = mock(AuthRedisApplicationService.class);
        ReflectionTestUtils.setField(service, "authApplicationService", authApplicationService);
        ReflectionTestUtils.setField(service, "authRedisApplicationService", authRedisApplicationService);
        when(authApplicationService.buildUserAuthResources(1001L)).thenReturn(Map.of("500", "AGENT"));

        service.handleUserOrganizationChanged(
            new UserOrganizationChangedEvent(this, Set.of(1001L)));

        verify(authApplicationService).buildUserAuthResources(1001L);
        verify(authRedisApplicationService).writeUserAuth(1001L, Map.of("500", "AGENT"));
    }
}
