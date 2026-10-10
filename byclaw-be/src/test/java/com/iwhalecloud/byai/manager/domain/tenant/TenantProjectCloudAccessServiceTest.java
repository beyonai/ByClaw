package com.iwhalecloud.byai.manager.domain.tenant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantMembershipMapper;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantMembershipRow;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

class TenantProjectCloudAccessServiceTest {
    private final TenantGroupData data = mock(TenantGroupData.class);
    private final TenantAdminTenantMapper tenants = mock(TenantAdminTenantMapper.class);
    private final TenantMembershipMapper memberships = mock(TenantMembershipMapper.class);
    private final TenantProjectCloudAccessService service = new TenantProjectCloudAccessService(data, tenants, memberships);
    private final Project project = new Project();
    private final TenantRequestContext tenant = new TenantRequestContext(10000077L, 11237409L, "MEMBER");

    @BeforeEach
    void setUp() {
        LoginInfo login = new LoginInfo();
        login.setUserId(tenant.userId());
        CurrentUserHolder.setLoginInfo(login);
        project.setProjectId(11246210L);
        project.setEnterpriseId(tenant.enterpriseId());
    }

    @AfterEach
    void clear() {
        CurrentUserHolder.clearLoginInfo();
        TenantRequestContextHolder.clear();
    }

    private void configureTenant() {
        when(tenants.selectConfig(tenant.enterpriseId(), "NODE_SANDBOX_RECORD_ID")).thenReturn("80");
        TenantMembershipRow membership = new TenantMembershipRow();
        membership.setRole("MEMBER");
        when(memberships.selectActiveMembership(tenant.userId(), tenant.enterpriseId())).thenReturn(membership);
    }

    @ParameterizedTest
    @CsvSource({"true,true,true", "true,false,false", "false,false,"})
    void usesNodeMembershipForBoundGroupsAndPreservesOrdinaryProjects(boolean bound, boolean canRead, Boolean allowed) {
        configureTenant();
        // 原目录请求不携带租户上下文，仍须按数据库项目绑定与当前登录用户鉴权。
        TenantRequestContextHolder.set(new TenantRequestContext(999L, 999L, "OWNER"));
        when(data.query(eq(tenant), eq("group-chats/project-access"), any())).thenReturn(
            new ObjectMapper().valueToTree(Map.of("bound", bound, "canRead", canRead)));
        assertThat(service.canRead(project)).isEqualTo(allowed);
        verify(data).query(tenant, "group-chats/project-access", Map.of("projectId", "11246210"));
    }

    @Test
    void legacyProjectsDoNotRequireNode() {
        assertThat(service.canRead(project)).isNull();
        project.setEnterpriseId(null);
        assertThat(service.canRead(project)).isNull();
        verifyNoInteractions(data, memberships);
    }

    @Test
    void inactiveTenantMemberAndAnonymousCallerCannotRead() {
        when(tenants.selectConfig(tenant.enterpriseId(), "NODE_SANDBOX_RECORD_ID")).thenReturn("80");
        assertThat(service.canRead(project)).isFalse();
        CurrentUserHolder.clearLoginInfo();
        assertThat(service.canRead(project)).isFalse();
        verifyNoInteractions(data);
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "{\"bound\":false}", "{\"bound\":\"false\",\"canRead\":true}"})
    void malformedNodeReplyCannotFallBackToPlatformMembership(String reply) throws Exception {
        configureTenant();
        when(data.query(eq(tenant), eq("group-chats/project-access"), any()))
            .thenReturn(new ObjectMapper().readTree(reply));
        assertThat(service.canRead(project)).isFalse();
    }

    @Test
    void nodeFailureDoesNotFallBackToStalePlatformMembership() {
        configureTenant();
        when(data.query(eq(tenant), eq("group-chats/project-access"), any()))
            .thenThrow(new IllegalStateException("Node unavailable"));
        assertThatThrownBy(() -> service.canRead(project)).isInstanceOf(IllegalStateException.class);
    }
}
