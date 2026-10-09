package com.iwhalecloud.byai.manager.domain.tenant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
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
    void available_preservesLargeEnterpriseIdsAndHidesInternalProvisionFields() {
        TenantMembershipMapper mapper = mock(TenantMembershipMapper.class);
        TenantContextService service = new TenantContextService(mapper, new ObjectMapper(), redis());
        LoginInfo login = new LoginInfo();
        login.setUserId(12L);
        CurrentUserHolder.setLoginInfo(login);
        TenantMembershipRow first = new TenantMembershipRow();
        first.setEnterpriseId("9007199254740993");
        first.setEnterpriseName("企业一");
        first.setRole("OWNER");
        first.setProvisionStateJson("{\"status\":\"READY\",\"fencingToken\":99}");
        TenantMembershipRow second = new TenantMembershipRow();
        second.setEnterpriseId("234");
        second.setEnterpriseName("企业二");
        second.setRole("MEMBER");
        second.setProvisionStateJson("{\"status\":\"PROVISIONING\",\"fencingToken\":100}");
        when(mapper.selectAvailableForUser(12L)).thenReturn(List.of(first, second));

        assertThat(service.available()).containsExactly(
            new TenantAvailableView("9007199254740993", "企业一", "OWNER", "READY"),
            new TenantAvailableView("234", "企业二", "MEMBER", "PROVISIONING"));
    }

    @Test
    void available_requiresAuthenticatedUser() {
        TenantContextService service = new TenantContextService(mock(TenantMembershipMapper.class),
            new ObjectMapper(), redis());

        assertThatThrownBy(service::available).isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("401");
    }

    @Test
    void switchAndEachRequestRecheckCurrentUserMembership() {
        TenantMembershipMapper mapper = mock(TenantMembershipMapper.class);
        TenantContextService service = new TenantContextService(mapper, new ObjectMapper(), redis());
        LoginInfo login = new LoginInfo();
        login.setUserId(12L);
        login.setSessionId("login-session-1");
        CurrentUserHolder.setLoginInfo(login);
        TenantMembershipRow membership = new TenantMembershipRow();
        membership.setEnterpriseId("123");
        membership.setRole("OWNER");
        membership.setProvisionStateJson("{\"status\":\"READY\"}");
        when(mapper.selectActiveMembership(12L, 123L)).thenReturn(membership);

        TenantSwitchView switched = service.switchTo("123");
        assertThat(switched.enterpriseId()).isEqualTo("123");
        assertThat(switched.role()).isEqualTo("OWNER");

        assertThat(service.validate("123"))
            .isEqualTo(new TenantRequestContext(12L, 123L, "OWNER"));
        assertThatThrownBy(() -> service.validate("124"))
            .isInstanceOf(ResponseStatusException.class).hasMessageContaining("404");
        when(mapper.selectActiveMembership(12L, 123L)).thenReturn(null);
        assertThatThrownBy(() -> service.validate("123"))
            .isInstanceOf(ResponseStatusException.class).hasMessageContaining("404");
    }

    @Test
    void switchIssuesTabContextTokenWithExpiry() {
        TenantMembershipMapper mapper = mock(TenantMembershipMapper.class);
        TenantContextService service = new TenantContextService(mapper, new ObjectMapper(), redis());
        LoginInfo login = new LoginInfo();
        login.setUserId(12L);
        login.setSessionId("login-session-1");
        CurrentUserHolder.setLoginInfo(login);
        TenantMembershipRow membership = new TenantMembershipRow();
        membership.setEnterpriseId("123");
        membership.setRole("OWNER");
        membership.setProvisionStateJson("{\"status\":\"READY\"}");
        when(mapper.selectActiveMembership(12L, 123L)).thenReturn(membership);

        var view = new ObjectMapper().valueToTree(service.switchTo("123"));

        assertThat(view.path("tenantContextToken").asText()).isNotBlank();
        assertThat(view.path("expiresAt").asText()).isNotBlank();
        assertThat(view.path("contextVersion").asInt()).isPositive();
    }

    @Test
    void developmentSwitchAllowsExistingMembershipBeforeTenantIsReady() {
        String originalEnvironment = System.getProperty("BE_ENV");
        try {
            System.setProperty("BE_ENV", "development");
            TenantMembershipMapper mapper = mock(TenantMembershipMapper.class);
            TenantContextService service = new TenantContextService(mapper, new ObjectMapper(), redis());
            LoginInfo login = new LoginInfo();
            login.setUserId(12L);
            login.setSessionId("login-session-1");
            CurrentUserHolder.setLoginInfo(login);
            when(mapper.selectActiveMembership(12L, 123L))
                .thenReturn(membership(123L, "MEMBER", "RESERVED"));

            TenantSwitchView view = service.switchTo("123");

            assertThat(view.enterpriseId()).isEqualTo("123");
            assertThat(view.role()).isEqualTo("MEMBER");
            assertThat(view.tenantContextToken()).isNotBlank();
            assertThat(service.validate("123")).isEqualTo(new TenantRequestContext(12L, 123L, "MEMBER"));
        }
        finally {
            if (originalEnvironment == null) System.clearProperty("BE_ENV");
            else System.setProperty("BE_ENV", originalEnvironment);
        }
    }

    private TenantMembershipRow membership(long enterpriseId, String role, String state) {
        TenantMembershipRow membership = new TenantMembershipRow();
        membership.setEnterpriseId(Long.toString(enterpriseId));
        membership.setRole(role);
        membership.setProvisionStateJson("{\"status\":\"" + state + "\"}");
        return membership;
    }

    @SuppressWarnings("unchecked")
    private StringRedisTemplate redis() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        ValueOperations<String, String> values = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(values);
        return redis;
    }
}
