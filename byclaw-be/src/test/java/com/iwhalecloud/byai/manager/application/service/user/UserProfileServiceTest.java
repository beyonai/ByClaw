package com.iwhalecloud.byai.manager.application.service.user;

import com.iwhalecloud.byai.manager.domain.organization.service.OrganizationService;
import com.iwhalecloud.byai.manager.domain.position.service.PositionService;
import com.iwhalecloud.byai.manager.domain.station.service.StationService;
import com.iwhalecloud.byai.manager.domain.superassist.service.SuasSuperassistService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.domain.users.service.UsersOrganizationService;
import com.iwhalecloud.byai.manager.entity.users.Users;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class UserProfileServiceTest {
    @Test
    void returnsUserCardWhenOptionalAssistantAndStationAreMissing() {
        UserApplicationService service = new UserApplicationService();
        UserService users = mock(UserService.class);
        ReflectionTestUtils.setField(service, "userService", users);
        ReflectionTestUtils.setField(service, "stationService", mock(StationService.class));
        ReflectionTestUtils.setField(service, "organizationService", mock(OrganizationService.class));
        ReflectionTestUtils.setField(service, "usersOrganizationService", mock(UsersOrganizationService.class));
        ReflectionTestUtils.setField(service, "positionService", mock(PositionService.class));
        ReflectionTestUtils.setField(service, "suasSuperassistService", mock(SuasSuperassistService.class));
        Users user = new Users();
        user.setUserId(42L);
        user.setUserName("Alice");
        user.setUserCode("E42");
        user.setStationId(9L);
        when(users.findById(42L)).thenReturn(user);

        var response = service.getUserSuas(42L);
        assertThat(response.getCode()).isZero();
        Map<?, ?> data = (Map<?, ?>) response.getData();
        assertThat(data.get("userName")).isEqualTo("Alice");
        assertThat(data.get("userCode")).isEqualTo("E42");
        assertThat(data.containsKey("phone")).isTrue();
        assertThat(data.containsKey("pathName")).isTrue();
        assertThat(service.getUserSuas(99L).getCode()).isEqualTo(-1);
    }
}
