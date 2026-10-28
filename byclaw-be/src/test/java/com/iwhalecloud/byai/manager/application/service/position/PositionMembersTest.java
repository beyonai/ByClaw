package com.iwhalecloud.byai.manager.application.service.position;

import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.login.bean.UsersOrganization;
import com.iwhalecloud.byai.manager.domain.position.service.PositionService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.domain.users.service.UsersOrganizationService;
import com.iwhalecloud.byai.manager.dto.position.PositionUserBindDTO;
import com.iwhalecloud.byai.manager.entity.position.Position;
import com.iwhalecloud.byai.manager.entity.users.Users;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.StaticMessageSource;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

class PositionMembersTest {

    private final PositionApplicationService service = new PositionApplicationService();
    private final PositionService positions = mock(PositionService.class);
    private final UserService users = mock(UserService.class);
    private final UsersOrganizationService memberships = mock(UsersOrganizationService.class);
    private Object originalMessages;

    @BeforeEach
    void setUp() {
        originalMessages = ReflectionTestUtils.getField(I18nUtil.class, "messageSource");
        StaticMessageSource messages = new StaticMessageSource();
        messages.setUseCodeAsDefaultMessage(true);
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messages);
        ReflectionTestUtils.setField(service, "positionService", positions);
        ReflectionTestUtils.setField(service, "userService", users);
        ReflectionTestUtils.setField(service, "usersOrganizationService", memberships);
        UsersOrganization role = new UsersOrganization();
        role.setUserType("PLAT_MAN");
        LoginInfo login = new LoginInfo();
        login.setUsersOrganizations(List.of(role));
        CurrentUserHolder.setLoginInfo(login);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", originalMessages);
    }

    @Test
    void rejectsUnauthorizedChangesBeforeLookingUpMembers() {
        CurrentUserHolder.clearLoginInfo();
        assertThatThrownBy(() -> service.addPositionUsers(request(List.of(7L)))).isInstanceOf(BaseException.class);
        assertThatThrownBy(() -> service.removePositionUsers(request(List.of(7L)))).isInstanceOf(BaseException.class);
        verifyNoInteractions(positions, users, memberships);
    }

    @Test
    void rejectsDigitalPositionsForBothOperations() {
        Position digital = new Position();
        digital.setIsDigitalPosition(1);
        when(positions.findById(10L)).thenReturn(digital);
        assertThatThrownBy(() -> service.addPositionUsers(request(List.of(7L)))).isInstanceOf(BaseException.class);
        assertThatThrownBy(() -> service.removePositionUsers(request(List.of(7L)))).isInstanceOf(BaseException.class);
        verifyNoInteractions(users, memberships);
    }

    @Test
    void validatesTheEntireBatchBeforeChangingAnyMembership() {
        when(positions.findById(10L)).thenReturn(new Position());
        when(users.findByIds(List.of(7L, 8L))).thenReturn(List.of(user(7L)));
        assertThatThrownBy(() -> service.addPositionUsers(request(List.of(7L, 8L)))).isInstanceOf(BaseException.class);
        verifyNoInteractions(memberships);
    }

    @Test
    void deduplicatesUserIdsAndUsesOnlyTheRequestedPosition() {
        when(positions.findById(10L)).thenReturn(new Position());
        when(users.findByIds(List.of(7L, 8L))).thenReturn(List.of(user(7L), user(8L)));
        service.addPositionUsers(request(List.of(7L, 7L, 8L)));
        service.removePositionUsers(request(List.of(7L, 7L, 8L)));
        verify(memberships).addPositionUsers(10L, List.of(7L, 8L));
        verify(memberships).removePositionUsers(10L, List.of(7L, 8L));
    }

    private PositionUserBindDTO request(List<Long> userIds) {
        PositionUserBindDTO request = new PositionUserBindDTO();
        request.setPositionId(10L);
        request.setUserIds(userIds);
        return request;
    }

    private Users user(Long userId) {
        Users user = new Users();
        user.setUserId(userId);
        user.setState("A");
        return user;
    }
}
