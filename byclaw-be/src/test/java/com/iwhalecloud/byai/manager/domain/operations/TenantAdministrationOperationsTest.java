package com.iwhalecloud.byai.manager.domain.operations;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.login.bean.UsersOrganization;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxUserContextRunner;
import com.iwhalecloud.byai.manager.domain.tenant.TenantAdminTenantService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantAdminTenantService.TenantView;
import com.iwhalecloud.byai.manager.domain.tenant.TenantDatasourceService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantDeletionService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantDbProvisioningService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 服务桥复用原租户服务并验证真实平台身份、状态版本和数据库准入。
 * @author Codex
 * @since 2026-10-31
 */
class TenantAdministrationOperationsTest {
    private final ObjectMapper objectMapper = new ObjectMapper();
    private TenantAdministrationOperations tenantAdministrationOperations;
    private TenantAdminTenantService tenantAdminTenantService;
    private TenantDatasourceService tenantDatasourceService;
    private TenantDeletionService tenantDeletionService;
    private TenantDbProvisioningService tenantDbProvisioningService;

    /** 所有业务服务和上下文读取均使用替身。 */
    @BeforeEach
    void prepare() {
        tenantAdministrationOperations = new TenantAdministrationOperations();
        tenantAdminTenantService = mock(TenantAdminTenantService.class);
        tenantDatasourceService = mock(TenantDatasourceService.class);
        tenantDeletionService = mock(TenantDeletionService.class);
        tenantDbProvisioningService = mock(TenantDbProvisioningService.class);
        SandboxUserContextRunner sandboxUserContextRunner = mock(SandboxUserContextRunner.class);
        doAnswer(invocation -> ((Supplier<?>) invocation.getArgument(1)).get())
            .when(sandboxUserContextRunner).callAsUser(eq("configured-admin"), any());
        ReflectionTestUtils.setField(tenantAdministrationOperations, "tenantAdminUserCode", "configured-admin");
        ReflectionTestUtils.setField(tenantAdministrationOperations, "sandboxUserContextRunner", sandboxUserContextRunner);
        ReflectionTestUtils.setField(tenantAdministrationOperations, "tenantAdminTenantService", tenantAdminTenantService);
        ReflectionTestUtils.setField(tenantAdministrationOperations, "tenantDatasourceService", tenantDatasourceService);
        ReflectionTestUtils.setField(tenantAdministrationOperations, "tenantDeletionService", tenantDeletionService);
        ReflectionTestUtils.setField(tenantAdministrationOperations, "tenantDbProvisioningService", tenantDbProvisioningService);
        ReflectionTestUtils.setField(tenantAdministrationOperations, "objectMapper", objectMapper);
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(42L);
        UsersOrganization usersOrganization = new UsersOrganization();
        usersOrganization.setUserType("PLAT_MAN");
        loginInfo.setUsersOrganizations(List.of(usersOrganization));
        CurrentUserHolder.setLoginInfo(loginInfo);
        when(tenantAdminTenantService.list(any())).thenReturn(List.of(tenant("READY")));
    }

    /** 避免测试身份泄漏到其他用例。 */
    @AfterEach
    void clearIdentity() {
        CurrentUserHolder.clearLoginInfo();
    }

    /** 返回原租户字段并附加状态版本，长 ID 不经过浮点数。 */
    @Test
    void listKeepsOriginalDataAndStringIdentifiers() {
        var result = tenantAdministrationOperations.execute("tenant-admin", "list", objectMapper.createObjectNode());
        assertThat(result.get(0).path("enterpriseId").asText()).isEqualTo("9007199254740993");
        assertThat(result.get(0).path("provisionState").asText()).isEqualTo("READY");
        assertThat(result.get(0).path("revision").asText()).isNotBlank();
    }

    /** 新建沿用原幂等号、精确套餐 ID 以及原异步开通入口。 */
    @Test
    void creationKeepsOriginalRequestAndProvisioningService() {
        ObjectNode payload = objectMapper.createObjectNode().put("enterpriseName", "tenant")
            .put("packageId", "9007199254740995").put("requestId", "stable-request-1")
            .put("reason", "create tenant").put("revision", "new");
        when(tenantAdminTenantService.create("tenant", 9007199254740995L, "stable-request-1"))
            .thenReturn(tenant("RESERVED"));
        var result = tenantAdministrationOperations.execute("tenant-admin", "create", payload);
        assertThat(result.path("enterpriseId").asText()).isEqualTo("9007199254740993");
        verify(tenantAdminTenantService).create("tenant", 9007199254740995L, "stable-request-1");
        verify(tenantDbProvisioningService).request(9007199254740993L);
    }

    /** 配置账号没有真实平台角色时，服务令牌也不能绕过业务权限。 */
    @Test
    void missingPlatformRoleCannotReadTenantData() {
        CurrentUserHolder.clearLoginInfo();
        assertThatThrownBy(() -> tenantAdministrationOperations.execute("tenant-admin", "list", objectMapper.createObjectNode()))
            .isInstanceOf(OperationsFailure.class);
        verify(tenantAdminTenantService, never()).list(any());
    }

    /** 旧页面版本不能删除状态已变化的租户。 */
    @Test
    void staleRevisionCannotDeleteTenant() {
        ObjectNode payload = objectMapper.createObjectNode().put("enterpriseId", "9007199254740993")
            .put("enterpriseName", "tenant").put("reason", "cleanup").put("revision", "old");
        assertThatThrownBy(() -> tenantAdministrationOperations.execute("tenant-admin", "delete", payload))
            .isInstanceOf(OperationsFailure.class);
        verify(tenantDeletionService, never()).request(anyString(), anyString());
    }

    /** 未开通租户不能连接数据库，伪造 confirmed=false 也不能绕过写入审计。 */
    @Test
    void datasourceChecksReadinessAndSqlMutationMetadata() {
        ObjectNode payload = objectMapper.createObjectNode().put("enterpriseId", "9007199254740993")
            .put("sql", "DELETE FROM byai.sample").put("page", 1).put("confirmed", false);
        assertThatThrownBy(() -> tenantAdministrationOperations.execute("tenant-datasource", "execute", payload))
            .isInstanceOf(OperationsFailure.class);
        when(tenantAdminTenantService.list(any())).thenReturn(List.of(tenant("DB_CREATING")));
        assertThatThrownBy(() -> tenantAdministrationOperations.execute("tenant-datasource", "tables", payload))
            .isInstanceOf(OperationsFailure.class);
        verify(tenantDatasourceService, never()).tables(anyLong());
        verify(tenantDatasourceService, never()).execute(anyLong(), anyString(), anyInt(), anyBoolean());
    }

    /**
     * 原列表投影样本，不包含连接凭据。
     * @param state 开通状态
     * @return 测试租户投影
     */
    private TenantView tenant(String state) {
        return new TenantView("9007199254740993", "tenant", "package", state, state, null, null, null);
    }
}
