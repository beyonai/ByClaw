package com.iwhalecloud.byai.manager.domain.tenant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.constants.users.UserType;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.login.bean.UsersOrganization;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantRow;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantPackageRow;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class TenantAdminTenantServiceTest {

    private final TenantAdminTenantMapper mapper = mock(TenantAdminTenantMapper.class);
    private final SequenceService sequenceService = mock(SequenceService.class);
    private final TenantAdminTenantService service = new TenantAdminTenantService(mapper, sequenceService,
        new ObjectMapper());

    @AfterEach
    void clearLogin() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void rejectsNonAdministratorBeforeReadingPackages() {
        assertThatThrownBy(() -> service.create("测试租户01", 1, "request-001"))
            .isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("403");
        verify(mapper, never()).selectEnabledPackage(1);
    }

    @Test
    void reservesTenantAndSnapshotsBasicPackage() {
        platformAdmin();
        TenantPackageRow selectedPackage = new TenantPackageRow();
        selectedPackage.setId(1L);
        selectedPackage.setPackageName("基础版");
        selectedPackage.setPackageContent("{\"profileKey\":\"s\",\"memberLimit\":10}");
        when(mapper.selectEnabledPackage(1)).thenReturn(selectedPackage);
        AtomicLong ids = new AtomicLong(123);
        when(sequenceService.nextVal()).thenAnswer(ignored -> ids.getAndIncrement());

        TenantAdminTenantService.TenantView tenant = service.create("测试租户01", 1, "request-001");

        assertThat(tenant.enterpriseId()).isEqualTo("123");
        assertThat(tenant.provisionState()).isEqualTo("RESERVED");
        verify(mapper).insertEnterprise(123L, "测试租户01");
        verify(mapper).insertConfig(127L, 123L, "PACKAGE_CONTENT_SNAPSHOT", selectedPackage.getPackageContent());
        verify(mapper).insertOwner(129L, 123L, 1L);
    }

    @Test
    void listsTenantWithTimeAndFailureReasonUsingValidatedFilters() {
        platformAdmin();
        TenantAdminTenantRow row = new TenantAdminTenantRow();
        row.setEnterpriseId(123L);
        row.setEnterpriseName("测试租户01");
        row.setPackageName("基础版");
        row.setProvisionStateJson("{\"status\":\"FAILED\"}");
        row.setCreatedAt("2026-09-28 10:00:00");
        row.setFailureReason("OpenSandbox pull failed");
        when(mapper.selectTenants(org.mockito.ArgumentMatchers.eq("测试"),
            org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.eq("createdAt"), org.mockito.ArgumentMatchers.eq("desc")))
            .thenReturn(List.of(row));

        var tenants = service.list(new TenantAdminTenantService.TenantListFilter(
            "测试", "2026-09-28T00:00:00", "2026-09-29T00:00:00", "createdAt", "desc"));

        assertThat(tenants).hasSize(1);
        assertThat(tenants.get(0).createdAt()).isEqualTo("2026-09-28 10:00:00");
        assertThat(tenants.get(0).failureReason()).isEqualTo("OpenSandbox pull failed");
    }

    private void platformAdmin() {
        UsersOrganization organization = new UsersOrganization();
        organization.setUserType(UserType.PLAT_MAN);
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(1L);
        loginInfo.setUsersOrganizations(List.of(organization));
        CurrentUserHolder.setLoginInfo(loginInfo);
    }
}
