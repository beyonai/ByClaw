package com.iwhalecloud.byai.manager.domain.tenant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantMembershipMapper;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantMembershipRow;

class TenantContextServiceTest {

    @AfterEach
    void clearLogin() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void availablePreservesLargeEnterpriseIdsAndHidesInternalProvisionFields() {
        TenantMembershipMapper mapper = mock(TenantMembershipMapper.class);
        TenantContextService service = service(mapper);
        CurrentUserHolder.setLoginInfo(login(12L));
        TenantMembershipRow first = membership("9007199254740993", "企业一", "OWNER", "READY");
        first.setProvisionStateJson("{\"status\":\"READY\",\"fencingToken\":99}");
        TenantMembershipRow second = membership("234", "企业二", "MEMBER", "PROVISIONING");
        when(mapper.selectAvailableForUser(12L)).thenReturn(List.of(first, second));

        assertThat(service.available()).containsExactly(
            new TenantAvailableView("9007199254740993", "企业一", "OWNER", "READY"),
            new TenantAvailableView("234", "企业二", "MEMBER", "PROVISIONING"));
    }

    @Test
    void switchOnlyValidatesMembershipAndDoesNotIssueToken() {
        TenantMembershipMapper mapper = mock(TenantMembershipMapper.class);
        TenantContextService service = service(mapper);
        CurrentUserHolder.setLoginInfo(login(12L));
        when(mapper.selectActiveMembership(12L, 123L)).thenReturn(membership("123", null, "OWNER", "READY"));

        TenantSwitchView switched = service.switchTo("123");

        assertThat(switched).isEqualTo(new TenantSwitchView("123", "OWNER"));
        assertThat(service.validate(12L, 123L))
            .isEqualTo(new TenantRequestContext(12L, 123L, "OWNER"));
    }

    @Test
    void eachRequestRechecksCurrentUserMembership() {
        TenantMembershipMapper mapper = mock(TenantMembershipMapper.class);
        TenantContextService service = service(mapper);
        CurrentUserHolder.setLoginInfo(login(12L));
        TenantMembershipRow membership = membership("123", null, "OWNER", "READY");
        when(mapper.selectActiveMembership(12L, 123L)).thenReturn(membership).thenReturn(null);

        assertThat(service.validate("123"))
            .isEqualTo(new TenantRequestContext(12L, 123L, "OWNER"));
        assertThatThrownBy(() -> service.validate("123"))
            .isInstanceOf(ResponseStatusException.class).hasMessageContaining("404");
    }

    @Test
    void explicitUserIdMustMatchAuthenticatedIdentity() {
        TenantMembershipMapper mapper = mock(TenantMembershipMapper.class);
        TenantContextService service = service(mapper);
        CurrentUserHolder.setLoginInfo(login(12L));

        assertThatThrownBy(() -> service.validate(13L, 123L))
            .isInstanceOf(ResponseStatusException.class).hasMessageContaining("401");
    }

    @Test
    void developmentSwitchAllowsExistingMembershipBeforeTenantIsReady() {
        String originalEnvironment = System.getProperty("BE_ENV");
        try {
            System.setProperty("BE_ENV", "development");
            TenantMembershipMapper mapper = mock(TenantMembershipMapper.class);
            TenantContextService service = service(mapper);
            CurrentUserHolder.setLoginInfo(login(12L));
            when(mapper.selectActiveMembership(12L, 123L)).thenReturn(membership("123", null, "MEMBER", "RESERVED"));

            assertThat(service.switchTo("123")).isEqualTo(new TenantSwitchView("123", "MEMBER"));
        }
        finally {
            if (originalEnvironment == null) {
                System.clearProperty("BE_ENV");
            }
            else {
                System.setProperty("BE_ENV", originalEnvironment);
            }
        }
    }

    private TenantContextService service(TenantMembershipMapper mapper) {
        return new TenantContextService(mapper, new ObjectMapper(), mock(TenantModeService.class));
    }

    private LoginInfo login(long userId) {
        LoginInfo login = new LoginInfo();
        login.setUserId(userId);
        login.setSessionId("login-session-1");
        return login;
    }

    private TenantMembershipRow membership(String enterpriseId, String name, String role, String state) {
        TenantMembershipRow membership = new TenantMembershipRow();
        membership.setEnterpriseId(enterpriseId);
        membership.setEnterpriseName(name);
        membership.setRole(role);
        membership.setProvisionStateJson("{\"status\":\"" + state + "\"}");
        return membership;
    }
}
