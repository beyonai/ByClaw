package com.iwhalecloud.byai.common.login.auth;

import com.iwhalecloud.byai.common.constants.users.UserType;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.login.bean.UsersOrganization;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import static org.assertj.core.api.Assertions.assertThat;

class CurrentUserHolderRoleTest {
    @AfterEach
    void clearLogin() {
        CurrentUserHolder.clearLoginInfo();
    }

    @ParameterizedTest
    @ValueSource(strings = {"PLAT_MAN", "plat_man", "Plat_Man"})
    void platformRoleIgnoresCaseAndReturnsCanonicalCode(String role) {
        login(role);
        assertThat(CurrentUserHolder.isPlatformManager()).isTrue();
        assertThat(CurrentUserHolder.isPlatformAdminOrOperator()).isTrue();
        assertThat(CurrentUserHolder.getHighestUserType()).isEqualTo(UserType.PLAT_MAN);
        assertThat(CurrentUserHolder.getUserTypes()).containsExactly(role);
    }

    @ParameterizedTest
    @ValueSource(strings = {"plat_devops", "org_man", "business_man", "ORD_USER", "PLAT_MAN_EXTRA", ""})
    void otherRolesNeverBecomePlatformManagers(String role) {
        login(role);
        assertThat(CurrentUserHolder.isPlatformManager()).isFalse();
        assertThat(CurrentUserHolder.isPlatformAdminOrOperator()).isEqualTo("plat_devops".equals(role));
    }

    @Test
    void missingLoginAndNullRolesDoNotGrantAccess() {
        CurrentUserHolder.clearLoginInfo();
        assertThat(CurrentUserHolder.isPlatformManager()).isFalse();
        assertThat(CurrentUserHolder.isPlatformAdminOrOperator()).isFalse();
        login(null);
        assertThat(CurrentUserHolder.isPlatformManager()).isFalse();
        assertThat(CurrentUserHolder.getHighestUserType()).isEqualTo(UserType.ORD_USER);
        assertThat(UserType.matchesAny(null, UserType.PLAT_MAN)).isFalse();
    }

    private void login(String role) {
        LoginInfo login = new LoginInfo();
        UsersOrganization organization = new UsersOrganization();
        organization.setUserType(role);
        login.setUsersOrganizations(List.of(organization));
        CurrentUserHolder.setLoginInfo(login);
    }
}
