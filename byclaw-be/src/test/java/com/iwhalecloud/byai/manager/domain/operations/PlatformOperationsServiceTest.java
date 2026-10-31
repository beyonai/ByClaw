package com.iwhalecloud.byai.manager.domain.operations;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData;
import com.iwhalecloud.byai.gateway.sandbox.runtime.SandboxRuntimeInventory;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxReleaseException;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxUserContextRunner;
import com.iwhalecloud.byai.manager.domain.tenant.TenantDbProvisioningService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient;
import com.iwhalecloud.byai.manager.mapper.operations.OperationsSandboxMapper;
import com.iwhalecloud.byai.manager.vo.operations.OperationsSandboxVo;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Map;
import java.util.List;
import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 生命周期复用、敏感字段投影与版本竞争。
 * @author Codex
 * @since 2026-10-23
 */
class PlatformOperationsServiceTest {
    private final ObjectMapper json = new ObjectMapper();
    private PlatformOperationsService service;
    private OperationsSandboxMapper records;
    private SandboxService sandboxes;
    private TenantDbProvisioningService tenants;
    private SandboxUserContextRunner context;
    private TenantNodeClient nodes;

    /** 所有远程调用使用替身。 */
    @BeforeEach
    void prepare() {
        service = new PlatformOperationsService();
        records = mock(OperationsSandboxMapper.class);
        sandboxes = mock(SandboxService.class);
        tenants = mock(TenantDbProvisioningService.class);
        context = mock(SandboxUserContextRunner.class);
        nodes = mock(TenantNodeClient.class);
        SandboxRuntimeInventory inventory = mock(SandboxRuntimeInventory.class);
        when(inventory.current()).thenReturn(Map.of());
        ReflectionTestUtils.setField(service, "json", json);
        ReflectionTestUtils.setField(service, "records", records);
        ReflectionTestUtils.setField(service, "sandboxes", sandboxes);
        ReflectionTestUtils.setField(service, "tenants", tenants);
        ReflectionTestUtils.setField(service, "inventory", inventory);
        ReflectionTestUtils.setField(service, "userContext", context);
        ReflectionTestUtils.setField(service, "nodes", nodes);
    }

    /** 未读到运行时不能显示停止，敏感字段不可返回。 */
    @Test
    void detailProjectsSafeFieldsAndKeepsUnknownRuntime() {
        OperationsSandboxVo record = record("USER", "RUNNING");
        record.setGatewayToken("secret-never-output");
        record.setEndpoint("https://private.invalid");
        when(records.selectDetail(9)).thenReturn(record);
        ObjectNode request = request("detail");
        var result = service.execute(request);
        assertThat(result.path("id").asText()).isEqualTo("9");
        assertThat(result.path("runtimeStatus").asText()).isEqualTo("UNKNOWN");
        assertThat(result.path("canRelease").asBoolean()).isTrue();
        assertThat(result.toString()).doesNotContain("secret-never-output", "private.invalid", "endpoint");
    }

    /** 旧版本不能触发释放；原版本只有一个 CAS 胜者。 */
    @Test
    void staleOrContendedCommandNeverReachesRuntime() {
        when(records.selectDetail(9)).thenReturn(record("USER", "RUNNING"));
        ObjectNode request = request("release");
        ((ObjectNode) request.path("payload")).put("revision", "9:0:RUNNING");
        assertThatThrownBy(() -> service.execute(request)).isInstanceOf(OperationsFailure.class);
        ((ObjectNode) request.path("payload")).put("revision", "9:1:RUNNING");
        when(records.claim(any(), eq("release"))).thenReturn(0);
        assertThatThrownBy(() -> service.execute(request)).isInstanceOf(OperationsFailure.class);
        verify(sandboxes, never()).removeSandboxById(any());
    }

    /** 企业持久沙箱只能通过已有重启流程，不能误调用用户释放。 */
    @Test
    void enterpriseRestartIsAcceptedAndReleaseIsRejected() {
        OperationsSandboxVo record = record("TENANT", "RUNNING");
        record.setSandboxType("tenant-data-node");
        record.setEnterpriseId(42L);
        when(records.selectDetail(9)).thenReturn(record);
        when(records.claim(any(), eq("restart"))).thenReturn(1);
        assertThat(service.execute(request("restart")).path("accepted").asBoolean()).isTrue();
        verify(tenants).requestRestart(42, "tenant-data-node", 9);
        assertThatThrownBy(() -> service.execute(request("release"))).isInstanceOf(OperationsFailure.class);
        verify(sandboxes, never()).removeSandboxById(any());
    }

    /** 历史记录和停用账号都不允许重新启动。 */
    @Test
    void oldRecordAndDisabledAccountCannotLaunch() {
        OperationsSandboxVo record = record("USER", "RELEASED");
        record.setUserActive(false);
        when(records.selectDetail(9)).thenReturn(record);
        ObjectNode request = request("start");
        ((ObjectNode) request.path("payload")).put("revision", "9:1:RELEASED");
        assertThatThrownBy(() -> service.execute(request)).isInstanceOf(OperationsFailure.class);
        record.setUserActive(true);
        record.setCurrentRecord(false);
        assertThatThrownBy(() -> service.execute(request)).isInstanceOf(OperationsFailure.class);
        verify(records, never()).claim(any(), any());
    }

    /** 已释放 OpenClaw 恢复时复用原档位，不退回默认规格。 */
    @Test
    void launchPreservesRecordedOpenClawProfile() {
        OperationsSandboxVo record = record("USER", "RELEASED");
        record.setResourceId(-1L);
        record.setProfileKey("medium");
        when(sandboxes.launchSandboxWithServiceKey("user9", "openclaw-medium"))
            .thenReturn(new SandboxLaunchData());
        when(records.selectDetail(9)).thenReturn(record);
        when(records.claim(any(), eq("start"))).thenReturn(1);
        doAnswer(invocation -> invocation.<Supplier<?>>getArgument(1).get())
            .when(context).callAsUser(eq("user9"), any());
        ObjectNode request = request("start");
        ((ObjectNode) request.path("payload")).put("revision", "9:1:RELEASED");
        service.execute(request);
        verify(sandboxes).launchSandboxWithServiceKey("user9", "openclaw-medium");
        verify(sandboxes, never()).launchSandbox(any(), any());
    }

    /** 数字员工绑定的正资源 ID 仍走原有资源解析逻辑。 */
    @Test
    void resourceLaunchKeepsItsExistingRouting() {
        OperationsSandboxVo record = record("USER", "FAILED");
        record.setResourceId(73L);
        record.setSandboxType("custom-agent");
        when(sandboxes.launchSandbox("user9", 73L)).thenReturn(new SandboxLaunchData());
        when(records.selectDetail(9)).thenReturn(record);
        when(records.claim(any(), eq("start"))).thenReturn(1);
        doAnswer(invocation -> invocation.<Supplier<?>>getArgument(1).get())
            .when(context).callAsUser(eq("user9"), any());
        ObjectNode request = request("start");
        ((ObjectNode) request.path("payload")).put("revision", "9:1:FAILED");
        service.execute(request);
        verify(sandboxes).launchSandbox("user9", 73L);
        verify(sandboxes, never()).launchSandboxWithServiceKey(any(), any());
    }

    /** 既有服务返回空结果表示启动失败，不能向运营端返回受理成功。 */
    @Test
    void failedLaunchDoesNotReturnAccepted() {
        OperationsSandboxVo record = record("USER", "RELEASED");
        when(records.selectDetail(9)).thenReturn(record);
        when(records.claim(any(), eq("start"))).thenReturn(1);
        doAnswer(invocation -> invocation.<Supplier<?>>getArgument(1).get())
            .when(context).callAsUser(eq("user9"), any());
        ObjectNode request = request("start");
        ((ObjectNode) request.path("payload")).put("revision", "9:1:RELEASED");
        assertThatThrownBy(() -> service.execute(request)).isInstanceOf(OperationsFailure.class)
            .extracting("kind").isEqualTo("FAILED");
        verify(sandboxes).launchSandboxWithServiceKey("user9", "openclaw");
    }

    /** 释放过程可查询，但不允许重复启动、释放或重启。 */
    @Test
    void releasingRecordsAreQueryableWithoutMutationCapabilities() {
        when(records.selectRows(any())).thenReturn(List.of(record("USER", "RELEASING")));
        ObjectNode request = request("list");
        ((ObjectNode) request.path("payload")).put("status", "RELEASING");
        var row = service.execute(request).path("list").get(0);
        assertThat(row.path("status").asText()).isEqualTo("RELEASING");
        assertThat(row.path("canStart").asBoolean()).isFalse();
        assertThat(row.path("canRelease").asBoolean()).isFalse();
        assertThat(row.path("canRestart").asBoolean()).isFalse();
    }

    /** 释放明确失败与无结果都不产生受理回执，跳过执行也必须重读。 */
    @Test
    void releaseFailureAndSkippedReleaseCannotReturnAccepted() {
        when(records.selectDetail(9)).thenReturn(record("USER", "RUNNING"));
        when(records.claim(any(), eq("release"))).thenReturn(1);
        assertThatThrownBy(() -> service.execute(request("release")))
            .isInstanceOf(OperationsFailure.class).extracting("kind").isEqualTo("UNKNOWN");
        SandboxReleaseException failure = mock(SandboxReleaseException.class);
        doThrow(failure).when(sandboxes).removeSandboxById(9L);
        assertThatThrownBy(() -> service.execute(request("release")))
            .isInstanceOf(OperationsFailure.class).extracting("kind").isEqualTo("RELEASE_FAILED");
        when(failure.isOutcomeUnknown()).thenReturn(true);
        assertThatThrownBy(() -> service.execute(request("release")))
            .isInstanceOf(OperationsFailure.class).extracting("kind").isEqualTo("UNKNOWN");
    }

    /** 只有重读确认已释放后才返回受理成功。 */
    @Test
    void confirmedReleaseReturnsAccepted() {
        when(records.selectDetail(9)).thenReturn(record("USER", "RUNNING"), record("USER", "RELEASED"));
        when(records.claim(any(), eq("release"))).thenReturn(1);
        assertThat(service.execute(request("release")).path("accepted").asBoolean()).isTrue();
        verify(sandboxes).removeSandboxById(9L);
    }

    /** 已释放记录对应的实例若仍活跃，展示与执行都阻止再次启动。 */
    @Test
    void activeRuntimeBlocksLaunchingFromStaleReleasedRecord() {
        OperationsSandboxVo record = record("USER", "RELEASED");
        record.setSandboxId("runtime-9");
        when(records.selectDetail(9)).thenReturn(record);
        SandboxRuntimeInventory inventory = mock(SandboxRuntimeInventory.class);
        when(inventory.current()).thenReturn(Map.of("runtime-9", "RUNNING"));
        ReflectionTestUtils.setField(service, "inventory", inventory);
        assertThat(service.execute(request("detail")).path("canStart").asBoolean()).isFalse();
        ObjectNode request = request("start");
        ((ObjectNode) request.path("payload")).put("revision", "9:1:RELEASED");
        assertThatThrownBy(() -> service.execute(request)).isInstanceOf(OperationsFailure.class);
        verify(records, never()).claim(any(), any());
    }

    /** 关联会话只能转发至指定企业的固定只读入口。 */
    @Test
    void groupConversationsUseFixedTenantRoute() {
        ObjectNode request = request("conversations");
        request.put("resource", "groups");
        ((ObjectNode) request.path("payload")).put("enterpriseId", "42").put("pageNum", 2);
        service.execute(request);
        verify(nodes).operationsRequest(eq(42L), eq("POST"),
            eq("/internal/v1/operations/groups/9/conversations/query"),
            eq(json.createObjectNode().put("pageNum", 2).put("pageSize", 20)), any());
    }

    /** 固定白名单之外的运行控制不开放。 */
    @Test
    void disablePolicyAndMalformedIdentifiersAreRejected() {
        when(records.selectDetail(9)).thenReturn(record("USER", "RUNNING"));
        assertThatThrownBy(() -> service.execute(request("disable"))).isInstanceOf(OperationsFailure.class);
        ObjectNode request = request("detail");
        ((ObjectNode) request.path("payload")).put("id", "9223372036854775808");
        assertThatThrownBy(() -> service.execute(request)).isInstanceOf(OperationsFailure.class);
    }

    /** 构造稳定版本的当前记录。 */
    private OperationsSandboxVo record(String scope, String status) {
        OperationsSandboxVo record = new OperationsSandboxVo();
        record.setId(9L);
        record.setLockVersion(1);
        record.setOwnerScope(scope);
        record.setSandboxType("openclaw");
        record.setStatus(status);
        record.setUserCode("user9");
        record.setCurrentRecord(true);
        record.setUserActive(true);
        return record;
    }

    /** 模拟已经通过平台认证的服务请求。 */
    private ObjectNode request(String action) {
        ObjectNode request = json.createObjectNode().put("resource", "sandboxes").put("operation", action)
            .put("actor", "operator").put("requestId", "request-1");
        request.putObject("payload").put("id", "9").put("revision", "9:1:RUNNING").put("reason", "维护");
        return request;
    }
    /** 租户请求只分发给固定适配器，不能落到沙箱运行操作。 */
    @Test
    void tenantResourcesDispatchToOriginalServiceAdapter() {
        TenantAdministrationOperations tenantAdministrationOperations = mock(TenantAdministrationOperations.class);
        ReflectionTestUtils.setField(service, "tenantAdministrationOperations", tenantAdministrationOperations);
        ObjectNode tenantRequest = json.createObjectNode().put("resource", "tenant-admin")
            .put("operation", "list").put("actor", "platform-admin-7").put("requestId", "request-7");
        ObjectNode payload = tenantRequest.putObject("payload").put("name", "tenant");
        when(tenantAdministrationOperations.execute("tenant-admin", "list", payload)).thenReturn(json.createArrayNode());
        assertThat(service.execute(tenantRequest).isArray()).isTrue();
        verify(tenantAdministrationOperations).execute("tenant-admin", "list", payload);
        verify(records, never()).selectDetail(anyLong());
    }
}

