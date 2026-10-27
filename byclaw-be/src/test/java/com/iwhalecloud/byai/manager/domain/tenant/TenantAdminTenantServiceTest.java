package com.iwhalecloud.byai.manager.domain.tenant;

import com.iwhalecloud.byai.common.i18n.I18nTestSupport;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
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

class TenantAdminTenantServiceTest extends I18nTestSupport {

    private final TenantAdminTenantMapper mapper = mock(TenantAdminTenantMapper.class);
    private final SequenceService sequenceService = mock(SequenceService.class);
    private final TenantSandboxProperties sandboxProperties = new TenantSandboxProperties();
    private final TenantAdminTenantService service = new TenantAdminTenantService(mapper, sequenceService,
        new ObjectMapper(), new com.iwhalecloud.byai.common.hook.HookPublisher(
            new org.springframework.beans.factory.support.DefaultListableBeanFactory()
                .getBeanProvider(com.iwhalecloud.byai.common.hook.HookDispatcher.class)), sandboxProperties);

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
    void reservesTenantWithMediumProfileAndPreservesBasicPackageMemberLimit() {
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
        verify(mapper).insertConfig(127L, 123L, "PACKAGE_CONTENT_SNAPSHOT", "{\"profileKey\":\"m\",\"memberLimit\":10}");
        verify(mapper).insertOwner(129L, 123L, 1L);
    }

    @Test
    void configuredProfileIsIndependentOfPackageResourceFields() throws Exception {
        platformAdmin();
        sandboxProperties.setProfileKey("s");
        TenantPackageRow selectedPackage = new TenantPackageRow();
        selectedPackage.setId(1L);
        selectedPackage.setPackageName("企业版");
        selectedPackage.setPackageContent("{\"memberLimit\":50,\"description\":\"Enterprise\"}");
        when(mapper.selectEnabledPackage(1)).thenReturn(selectedPackage);
        AtomicLong ids = new AtomicLong(123);
        when(sequenceService.nextVal()).thenAnswer(ignored -> ids.getAndIncrement());

        service.create("测试租户01", 1, "request-001");

        var snapshot = org.mockito.ArgumentCaptor.forClass(String.class);
        verify(mapper).insertConfig(anyLong(), eq(123L), eq("PACKAGE_CONTENT_SNAPSHOT"), snapshot.capture());
        var content = new ObjectMapper().readTree(snapshot.getValue());
        assertThat(content.path("profileKey").asText()).isEqualTo("s");
        assertThat(content.path("memberLimit").asInt()).isEqualTo(50);
        assertThat(content.path("description").asText()).isEqualTo("Enterprise");
        verify(mapper).insertConfig(anyLong(), eq(123L), eq("PACKAGE_SPEC_ID"), eq("1"));
        verify(mapper).insertConfig(anyLong(), eq(123L), eq("PACKAGE_NAME_SNAPSHOT"), eq("企业版"));
    }

    @Test
    void replayDoesNotRewriteExistingTenantWhenDeploymentProfileChanges() {
        platformAdmin();
        sandboxProperties.setProfileKey("l");
        TenantPackageRow selectedPackage = new TenantPackageRow();
        selectedPackage.setId(1L);
        selectedPackage.setPackageName("基础版");
        selectedPackage.setPackageContent("{\"profileKey\":\"s\",\"memberLimit\":10}");
        when(mapper.selectEnabledPackage(1)).thenReturn(selectedPackage);
        TenantAdminTenantRow existing = new TenantAdminTenantRow();
        existing.setEnterpriseId(123L);
        existing.setEnterpriseName("测试租户01");
        existing.setPackageName("基础版");
        existing.setCreatedBy(1L);
        existing.setProvisionStateJson("{\"status\":\"RESERVED\"}");
        when(mapper.selectByRequestId("request-001")).thenReturn(existing);

        assertThat(service.create("测试租户01", 1, "request-001").enterpriseId()).isEqualTo("123");

        verify(mapper, never()).insertEnterprise(anyLong(), any());
        verify(mapper, never()).insertConfig(anyLong(), anyLong(), any(), any());
        verify(sequenceService, never()).nextVal();
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

    @Test
    void persistedFailureKeysUseTheViewersLocaleAndLegacyDiagnosticsRemainReadable() {
        platformAdmin();
        TenantAdminTenantRow row = new TenantAdminTenantRow();
        row.setEnterpriseId(123L);
        row.setProvisionStateJson("{\"status\":\"FAILED\"}");
        row.setFailureReason("tenant.node.launch.incomplete");
        when(mapper.selectTenants(any(), any(), any(), any(), any())).thenReturn(List.of(row));
        var filter = new TenantAdminTenantService.TenantListFilter(null, null, null, null, null);
        org.springframework.context.i18n.LocaleContextHolder.setLocale(java.util.Locale.US);
        assertThat(service.list(filter).getFirst().failureReason()).isEqualTo("tenant Node launch configuration is incomplete");
        org.springframework.context.i18n.LocaleContextHolder.setLocale(java.util.Locale.SIMPLIFIED_CHINESE);
        assertThat(service.list(filter).getFirst().failureReason()).isEqualTo("租户 Node 启动配置不完整");
        row.setFailureReason("tenant deletion failed: IllegalStateException");
        assertThat(service.list(filter).getFirst().failureReason()).isEqualTo("租户删除失败：IllegalStateException");
        row.setFailureReason("provider diagnostic");
        assertThat(service.list(filter).getFirst().failureReason()).isEqualTo("provider diagnostic");
    }

}
