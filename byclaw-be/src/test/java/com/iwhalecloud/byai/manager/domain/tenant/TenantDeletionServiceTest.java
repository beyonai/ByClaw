package com.iwhalecloud.byai.manager.domain.tenant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.constants.users.UserType;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.login.bean.UsersOrganization;
import com.iwhalecloud.byai.gateway.sandbox.service.TenantSandboxService;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.Executor;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.web.server.ResponseStatusException;

class TenantDeletionServiceTest {
    private static final long TENANT_ID = 11222154L;
    private final TenantAdminTenantMapper tenants = mock(TenantAdminTenantMapper.class);
    private final TenantSandboxService sandboxes = mock(TenantSandboxService.class);
    private final StringRedisTemplate redis = mock(StringRedisTemplate.class);
    private final SequenceService sequence = mock(SequenceService.class);
    private final Executor executor = mock(Executor.class);
    private final TenantDeletionService service = new TenantDeletionService(tenants, sandboxes,
        sequence, redis, new ObjectMapper(), executor);

    @AfterEach
    void clearLogin() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void requiresPlatformAdminAndExactTenantNameBeforeSchedulingDeletion() {
        assertThatThrownBy(() -> service.request(Long.toString(TENANT_ID), "中国移动01"))
            .isInstanceOf(ResponseStatusException.class).hasMessageContaining("403");
        verify(tenants, never()).selectManagedEnterpriseName(TENANT_ID);

        platformAdmin();
        when(tenants.selectManagedEnterpriseName(TENANT_ID)).thenReturn("中国移动01");
        assertThatThrownBy(() -> service.request(Long.toString(TENANT_ID), "中国电信01"))
            .isInstanceOf(ResponseStatusException.class).hasMessageContaining("400");
        verify(executor, never()).execute(any());
    }

    @Test
    void confirmedDeletionMarksTenantInaccessibleAndSchedulesCleanup() {
        platformAdmin();
        when(tenants.selectManagedEnterpriseName(TENANT_ID)).thenReturn("中国移动01");
        when(tenants.selectConfig(TENANT_ID, "PROVISION_STATE"))
            .thenReturn("{\"status\":\"FAILED\",\"generation\":\"1\"}");
        when(tenants.updateConfig(eq(TENANT_ID), eq("PROVISION_STATE"), anyString())).thenReturn(1);
        when(sequence.nextVal()).thenReturn(123L);

        assertThat(service.request(Long.toString(TENANT_ID), "中国移动01")).isEqualTo("ACCEPTED");

        verify(tenants).insertConfig(123L, TENANT_ID, "TENANT_DELETE_REQUESTED", "true");
        verify(tenants).updateConfig(eq(TENANT_ID), eq("PROVISION_STATE"), contains("DELETING"));
        verify(executor).execute(any());
    }

    @Test
    void deletesProviderResourcesBeforeRemovingTenantAffiliationsAndSecrets() {
        locked();
        when(tenants.selectConfig(TENANT_ID, "TENANT_DELETE_REQUESTED")).thenReturn("true");
        when(tenants.selectConfig(TENANT_ID, "PROVISION_STATE"))
            .thenReturn("{\"status\":\"DELETING\",\"generation\":\"1\"}");
        when(tenants.updateConfig(eq(TENANT_ID), eq("PROVISION_STATE"), anyString())).thenReturn(1);

        service.deleteNow(TENANT_ID);

        InOrder order = inOrder(sandboxes, tenants);
        order.verify(sandboxes).deleteTenantResources(TENANT_ID);
        order.verify(tenants).deleteTenantOrganizations(TENANT_ID);
        order.verify(tenants).deleteTenantMemberships(TENANT_ID);
        order.verify(tenants).deleteTenantResourceConfigs(TENANT_ID);
        verify(tenants).updateConfig(eq(TENANT_ID), eq("PROVISION_STATE"), contains("DELETED"));
        verify(tenants).deleteConfig(TENANT_ID, "TENANT_DELETE_REQUESTED");
        verify(redis, org.mockito.Mockito.times(2)).delete("TENANT_CONFIG_" + TENANT_ID);
    }

    @Test
    void keepsDeletionMarkerAndReportsFailureWhenProviderRemovalFails() {
        locked();
        when(tenants.selectConfig(TENANT_ID, "TENANT_DELETE_REQUESTED")).thenReturn("true");
        when(tenants.selectConfig(TENANT_ID, "PROVISION_STATE"))
            .thenReturn("{\"status\":\"DELETING\"}");
        when(tenants.updateConfig(eq(TENANT_ID), eq("PROVISION_STATE"), anyString())).thenReturn(1);
        doThrow(new IllegalStateException("provider unavailable")).when(sandboxes).deleteTenantResources(TENANT_ID);

        service.deleteNow(TENANT_ID);

        verify(tenants).updateConfig(eq(TENANT_ID), eq("PROVISION_STATE"), contains("DELETE_FAILED"));
        verify(tenants, never()).deleteTenantMemberships(TENANT_ID);
        verify(tenants, never()).deleteConfig(TENANT_ID, "TENANT_DELETE_REQUESTED");
    }

    private void locked() {
        @SuppressWarnings("unchecked")
        ValueOperations<String, String> values = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(values);
        when(values.setIfAbsent(eq("tenant:provision:db:" + TENANT_ID), anyString(),
            eq(Duration.ofMinutes(30)))).thenReturn(true);
    }

    private void platformAdmin() {
        UsersOrganization organization = new UsersOrganization();
        organization.setUserType(UserType.PLAT_MAN);
        LoginInfo login = new LoginInfo();
        login.setUserId(1L);
        login.setUsersOrganizations(List.of(organization));
        CurrentUserHolder.setLoginInfo(login);
    }
}
