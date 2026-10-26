package com.iwhalecloud.byai.manager.application.service.user;

import com.iwhalecloud.byai.common.i18n.I18nTestSupport;

import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.users.Users;
import java.util.List;
import org.junit.jupiter.api.Test;
import com.iwhalecloud.byai.common.lock.TransactionalRedisLockService;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.security.authentication.BadCredentialsException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class PhoneAccountRegistrationServiceTest extends I18nTestSupport {

    private final TransactionalRedisLockService locks = mock(TransactionalRedisLockService.class);
    private final UserService users = mock(UserService.class);
    private final UserApplicationService registrations = mock(UserApplicationService.class);
    private final PhoneAccountRegistrationService service =
        new PhoneAccountRegistrationService(locks, users, registrations);

    @Test
    void concurrentWinnerIsReusedAfterLockedLookup() {
        Users existing = new Users();
        when(users.findAllByUserPhone("13800138000")).thenReturn(List.of(existing));

        assertThat(service.resolveOrRegister("13800138000")).isSameAs(existing);
        verify(registrations, never()).registerByPhone("13800138000");
    }

    @Test
    void absentPhoneRegistersOnceAfterLockedLookup() {
        Users created = new Users();
        when(users.findAllByUserPhone("13800138000")).thenReturn(List.of());
        when(registrations.registerByPhone("13800138000")).thenReturn(created);

        assertThat(service.resolveOrRegister(" 13800138000 ")).isSameAs(created);
        var order = org.mockito.Mockito.inOrder(locks, users, registrations);
        order.verify(locks).acquire(org.mockito.ArgumentMatchers.startsWith("phone-registration:"));
        order.verify(users).findAllByUserPhone("13800138000");
        order.verify(registrations).registerByPhone("13800138000");
        verify(registrations).registerByPhone("13800138000");
    }

    @Test
    void duplicateAccountsCannotBeSelectedForLogin() {
        when(users.findAllByUserPhone("13800138000"))
            .thenReturn(List.of(new Users(), new Users()));

        assertThatThrownBy(() -> service.resolveOrRegister("13800138000"))
            .isInstanceOf(BadCredentialsException.class);
        verify(registrations, never()).registerByPhone("13800138000");
    }

    @Test
    void smsRegistrationRejectsAnExistingPhone() {
        when(users.findAllByUserPhone("13800138000")).thenReturn(List.of(new Users()));

        assertThatThrownBy(() -> service.registerNew("13800138000"))
            .isInstanceOf(BadCredentialsException.class);
        verify(registrations, never()).registerByPhone("13800138000");
    }

    @Test
    void unavailableRedisLockNeverStartsRegistration() {
        org.mockito.Mockito.doThrow(new DataAccessResourceFailureException("redis unavailable"))
            .when(locks).acquire(org.mockito.ArgumentMatchers.anyString());

        assertThatThrownBy(() -> service.resolveOrRegister("13800138000"))
            .isInstanceOf(DataAccessResourceFailureException.class);
        verify(registrations, never()).registerByPhone("13800138000");
    }
}
