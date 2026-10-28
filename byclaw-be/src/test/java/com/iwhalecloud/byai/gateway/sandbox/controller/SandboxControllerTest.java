package com.iwhalecloud.byai.gateway.sandbox.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verifyNoInteractions;

import java.util.Date;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.context.MessageSource;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.login.bean.UsersOrganization;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.constants.users.UserType;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.gateway.sandbox.mapper.SandboxServiceSpecEntityMapper;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxRecordView;
import com.iwhalecloud.byai.gateway.sandbox.persistence.SandboxServiceSpecEntity;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.gateway.sandbox.service.TenantSandboxService;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxBrowserNavigationService;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;

class SandboxControllerTest extends com.iwhalecloud.byai.common.i18n.I18nTestSupport {

    @Test
    void launchByUserCode_passesAutoReleaseAndKeepsItOptional() {
        for (Object value : java.util.Arrays.asList(0, 1, "0", "1", null)) {
            SandboxService service = mock(SandboxService.class);
            SandboxController controller = controllerWithInventory();
            ReflectionTestUtils.setField(controller, "sandboxService", service);
            ReflectionTestUtils.setField(controller, "sandboxUserContextRunner",
                new com.iwhalecloud.byai.gateway.sandbox.service.SandboxUserContextRunner(
                    mock(com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService.class)));
            Integer expected = value == null ? null : Integer.valueOf(value.toString());
            com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData data =
                new com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData();
            data.setSandboxId("created-sandbox");
            when(service.launchSandboxWithServiceKey("user001", "byclaw-dsh-tools", expected)).thenReturn(data);
            Map<String, Object> params = new java.util.HashMap<>();
            params.put("userCode", " user001 ");
            params.put("serviceKey", "byclaw-dsh-tools");
            if (value != null) params.put("autoRelease", value);

            ResponseUtil response = controller.launchByUserCode(params);
            assertThat(response.getCode()).isEqualTo(ResponseUtil.SUCCESS);
            assertThat(((Map<?, ?>) response.getData()).get("sandboxId")).isEqualTo("created-sandbox");
            verify(service).launchSandboxWithServiceKey("user001", "byclaw-dsh-tools", expected);

            params.put("autoRelease", null);
            when(service.launchSandboxWithServiceKey("user001", "byclaw-dsh-tools", null)).thenReturn(data);
            assertThat(controller.launchByUserCode(params).getCode()).isEqualTo(ResponseUtil.SUCCESS);
        }
    }

    @Test
    void launchByUserCode_rejectsInvalidAutoReleaseBeforeLaunching() {
        SandboxService service = mock(SandboxService.class);
        SandboxController controller = controllerWithInventory();
        ReflectionTestUtils.setField(controller, "sandboxService", service);
        for (Object invalid : List.of(-1, 2, true, 0.5, "", "false")) {
            ResponseUtil response = controller.launchByUserCode(
                Map.of("userCode", "user001", "autoRelease", invalid));
            assertThat(response.getCode()).isEqualTo(ResponseUtil.FAIL);
            assertThat(response.getMsg()).contains("autoRelease");
        }
        verifyNoInteractions(service);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void getSandboxInfo_returnsGatewayToken() {
        SandboxService sandboxService = mock(SandboxService.class);
        SsSandboxRecordMapper sandboxRecordMapper = mock(SsSandboxRecordMapper.class);
        SandboxController controller = controllerWithInventory();
        ReflectionTestUtils.setField(controller, "sandboxService", sandboxService);
        ReflectionTestUtils.setField(controller, "sandboxRecordMapper", sandboxRecordMapper);

        when(sandboxService.sandboxInfo("user001")).thenReturn(List.of(SandboxInfo.builder()
            .sandboxId("sandbox-1")
            .sandboxType("openclaw")
            .endpoints(List.of("http://host/proxy/18789/chat?token=0123456789abcdef0123456789abcdef"))
            .gatewayToken("0123456789abcdef0123456789abcdef")
            .build()));

        // Mock database record to return RUNNING status
        SsSandboxRecord record = new SsSandboxRecord();
        record.setStatus("RUNNING");
        when(sandboxRecordMapper.selectLatestBySandboxId("user001", "openclaw", "sandbox-1"))
            .thenReturn(record);

        ResponseUtil response = controller.getSandboxIdByUserCode(Map.of("userCode", "user001"));

        assertThat(response.getCode()).isEqualTo(ResponseUtil.SUCCESS);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> data = (List<Map<String, Object>>) response.getData();
        assertThat(data).hasSize(1);
        assertThat(data.get(0))
            .containsEntry("token", "0123456789abcdef0123456789abcdef")
            .containsEntry("status", "RUNNING")
            .doesNotContainKey("gatewayToken");
    }

    @Test
    void getSandboxInfo_sharedContextUsesItsOwnHeartbeatWithoutAnExclusiveRecord() {
        SandboxService sandboxService = mock(SandboxService.class);
        SsSandboxRecordMapper records = mock(SsSandboxRecordMapper.class);
        SandboxController controller = controllerWithInventory();
        ReflectionTestUtils.setField(controller, "sandboxService", sandboxService);
        ReflectionTestUtils.setField(controller, "sandboxRecordMapper", records);
        when(sandboxService.sandboxInfo("alice")).thenReturn(List.of(SandboxInfo.builder()
            .userCode("alice").sandboxType("custom-assistant").serviceKey("shared-host")
            .sandboxId("shared-1").isShared(true).mappingId("mapping-1")
            .workerId("current-generation-worker").workerOnline(true)
            .workerLastSeen(5_000L).workerLeaseTtlSeconds(30L).build()));

        ResponseUtil response = controller.getSandboxIdByUserCode(Map.of("userCode", "alice"));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> data = (List<Map<String, Object>>) response.getData();
        assertThat(data).hasSize(1);
        assertThat(data.get(0)).containsEntry("status", "RUNNING").containsEntry("isShared", true)
            .containsEntry("serviceKey", "shared-host").containsEntry("mappingId", "mapping-1")
            .containsEntry("workerId", "current-generation-worker").containsEntry("workerOnline", true)
            .containsEntry("workerLastSeen", 5_000L).containsEntry("workerLeaseTtlSeconds", 30L);
        verifyNoInteractions(records);
    }

    @Test
    void renewSandbox_returnsRenewedSandboxInfo() {
        SandboxService sandboxService = mock(SandboxService.class);
        SandboxController controller = controllerWithInventory();
        ReflectionTestUtils.setField(controller, "sandboxService", sandboxService);
        when(sandboxService.renewSandbox("user001", 123L)).thenReturn(SandboxInfo.builder()
            .sandboxId("sandbox-1")
            .userCode("user001")
            .sandboxType("openclaw")
            .endpoints(List.of("http://host/proxy/18789/chat?token=0123456789abcdef0123456789abcdef"))
            .gatewayToken("0123456789abcdef0123456789abcdef")
            .build());

        ResponseUtil response = controller.renewSandbox(Map.of("userCode", "user001", "resourceId", 123L));

        assertThat(response.getCode()).isEqualTo(ResponseUtil.SUCCESS);
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) response.getData();
        assertThat(data)
            .containsEntry("userCode", "user001")
            .containsEntry("sandboxType", "openclaw")
            .containsEntry("sandboxId", "sandbox-1")
            .containsEntry("token", "0123456789abcdef0123456789abcdef")
            .doesNotContainKey("gatewayToken");
    }

    @Test
    void listRecords_returnsOpenclawEndpointForJsonStorage() {
        setPlatformManager();
        SandboxController controller = controllerWithInventory();
        SandboxService sandboxService = mock(SandboxService.class);
        SsSandboxRecordMapper sandboxRecordMapper = mock(SsSandboxRecordMapper.class);
        ByaiSystemConfigService byaiSystemConfigService = mock(ByaiSystemConfigService.class);
        ReflectionTestUtils.setField(controller, "sandboxService", sandboxService);
        ReflectionTestUtils.setField(controller, "sandboxRecordMapper", sandboxRecordMapper);
        ReflectionTestUtils.setField(controller, "byaiSystemConfigService", byaiSystemConfigService);

        SsSandboxRecord record = new SsSandboxRecord();
        record.setId(1L);
        record.setUserCode("user001");
        record.setSandboxId("live-id");
        record.setSandboxType("openclaw");
        record.setEndpoint(
            "{\"openclaw\":\"http://host/proxy/18789/chat?token=abc\",\"ui\":\"http://host/proxy/3000?token=abc\"}");
        record.setCreateTime(new Date());
        when(sandboxRecordMapper.selectInventoryPage(org.mockito.ArgumentMatchers.anyMap())).thenReturn(List.of(record));
        SandboxRecordView view = new SandboxRecordView();
        view.setId(1L);
        view.setUserCode("user001");
        view.setSandboxType("openclaw");
        view.setEndpoint(record.getEndpoint());
        view.setWorkerOnline(false);
        when(sandboxService.buildRecordView(record)).thenReturn(view);
        when(sandboxRecordMapper.countInventory(org.mockito.ArgumentMatchers.anyMap())).thenReturn(1);
        when(byaiSystemConfigService.getDcSystemConfigValueByCode("WEB_BASE_URL")).thenReturn("");

        ResponseUtil response;
        try (var redis = mockStatic(RedisUtil.class)) {
            redis.when(() -> RedisUtil.getString("SHARE_BFM_USER_CODE_user001")).thenReturn("1001");
            redis.when(() -> RedisUtil.getString("SHARE_BFM_USER_1001"))
                .thenReturn("{\"userId\":1001,\"userCode\":\"user001\",\"userName\":\"Test User\"}");
            response = controller.listRecords(Map.of());
        }

        assertThat(response.getCode()).isEqualTo(ResponseUtil.SUCCESS);
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) response.getData();
        @SuppressWarnings("unchecked")
        List<SandboxRecordView> list = (List<SandboxRecordView>) data.get("list");
        assertThat(list).hasSize(1);
        assertThat(list.get(0).getUserName()).isEqualTo("Test User");
        assertThat(com.iwhalecloud.byai.gateway.sandbox.support.SandboxEndpointRecordSupport.parseInstanceEndpoints(
            list.get(0).getEndpoint())).containsEntry("openclaw", "http://host/proxy/18789/chat?token=abc")
            .containsEntry("ui", "http://host/proxy/3000?token=abc");
        assertThat(list.get(0).getWorkerOnline()).isFalse();
    }

    @Test
    void listRecords_filtersTenantSandboxRecordsByEnterprise() {
        setPlatformManager();
        SandboxController controller = controllerWithInventory();
        SandboxService sandboxService = mock(SandboxService.class);
        SsSandboxRecordMapper mapper = mock(SsSandboxRecordMapper.class);
        ByaiSystemConfigService configService = mock(ByaiSystemConfigService.class);
        TenantSandboxService tenantSandboxService = mock(TenantSandboxService.class);
        ReflectionTestUtils.setField(controller, "sandboxService", sandboxService);
        ReflectionTestUtils.setField(controller, "sandboxRecordMapper", mapper);
        ReflectionTestUtils.setField(controller, "byaiSystemConfigService", configService);
        ReflectionTestUtils.setField(controller, "tenantSandboxService", tenantSandboxService);
        SsSandboxRecord record = new SsSandboxRecord();
        record.setId(2L);
        record.setSandboxId("live-id");
        record.setSandboxType("tenant-opengauss");
        record.setOwnerScope("TENANT");
        record.setEnterpriseId(11220513L);
        record.setStatus("RUNNING");
        when(mapper.selectInventoryPage(org.mockito.ArgumentMatchers.anyMap())).thenReturn(List.of(record));
        when(mapper.countInventory(org.mockito.ArgumentMatchers.anyMap())).thenReturn(1);
        SandboxRecordView view = new SandboxRecordView();
        view.setId(2L);
        view.setSandboxType("tenant-opengauss");
        view.setOwnerScope("TENANT");
        view.setEnterpriseId(11220513L);
        view.setEndpoint("tcp://db-host:5432");
        when(sandboxService.buildRecordView(record)).thenReturn(view);


        ResponseUtil response = controller.listRecords(Map.of("ownerScope", "TENANT", "enterpriseId", "11220513"));

        assertThat(response.getCode()).isEqualTo(ResponseUtil.SUCCESS);
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) response.getData();
        @SuppressWarnings("unchecked")
        List<SandboxRecordView> list = (List<SandboxRecordView>) data.get("list");
        assertThat(list).hasSize(1);
        assertThat(list.get(0).getEndpoint()).isEqualTo("tcp://db-host:5432");
        assertThat(list.get(0).getProviderStatus()).isEqualTo("RUNNING");
        verify(mapper).countInventory(org.mockito.ArgumentMatchers.argThat(q -> "TENANT".equals(q.get("ownerScope")) && Long.valueOf(11220513L).equals(q.get("enterpriseId"))));
        verifyNoInteractions(tenantSandboxService);
    }

    @Test
    void emptyCurrentRuntimeReturnsZeroWithoutQueryingHistoricalRecordsOrTenantProvider() {
        setPlatformManager();
        SandboxController controller = controllerWithInventory();
        var inventory = mock(com.iwhalecloud.byai.gateway.sandbox.runtime.SandboxRuntimeInventory.class);
        when(inventory.current()).thenReturn(Map.of());
        var mapper = mock(SsSandboxRecordMapper.class);
        var tenants = mock(TenantSandboxService.class);
        ReflectionTestUtils.setField(controller, "runtimeInventory", inventory);
        ReflectionTestUtils.setField(controller, "sandboxRecordMapper", mapper);
        ReflectionTestUtils.setField(controller, "tenantSandboxService", tenants);
        when(mapper.selectInventoryPage(org.mockito.ArgumentMatchers.anyMap())).thenReturn(List.of());
        when(mapper.countInventory(org.mockito.ArgumentMatchers.anyMap())).thenReturn(0);
        var response = controller.listRecords(Map.of("ownerScope", "TENANT", "status", "RUNNING"));
        assertThat(((Map<?, ?>) response.getData()).get("total")).isEqualTo(0);
        assertThat(((Map<?, ?>) response.getData()).get("list")).isEqualTo(List.of());
        verify(mapper).selectInventoryPage(org.mockito.ArgumentMatchers.argThat(q ->
            "RUNNING".equals(q.get("status")) && ((List<?>) q.get("sandboxIds")).isEmpty()));
        verifyNoInteractions(tenants);
    }

    @Test
    void listRecords_includesPersistedStatusesAbsentFromTheRunningInventory() {
        setPlatformManager();
        SandboxController controller = new SandboxController();
        var inventory = mock(com.iwhalecloud.byai.gateway.sandbox.runtime.SandboxRuntimeInventory.class);
        when(inventory.current()).thenReturn(Map.of("live-id", "RUNNING"));
        var mapper = mock(SsSandboxRecordMapper.class);
        var service = mock(SandboxService.class);
        var config = mock(ByaiSystemConfigService.class);
        ReflectionTestUtils.setField(controller, "runtimeInventory", inventory);
        ReflectionTestUtils.setField(controller, "sandboxRecordMapper", mapper);
        ReflectionTestUtils.setField(controller, "sandboxService", service);
        ReflectionTestUtils.setField(controller, "byaiSystemConfigService", config);

        SsSandboxRecord released = new SsSandboxRecord();
        released.setId(9L);
        released.setSandboxId("released-id");
        released.setSandboxType("openclaw");
        released.setOwnerScope("USER");
        released.setStatus("RELEASED");
        when(mapper.selectInventoryPage(org.mockito.ArgumentMatchers.argThat(q ->
            "RELEASED".equals(q.get("status")) && ((List<?>) q.get("sandboxIds")).isEmpty())))
            .thenReturn(List.of(released));
        when(mapper.countInventory(org.mockito.ArgumentMatchers.anyMap())).thenReturn(1);
        SandboxRecordView view = new SandboxRecordView();
        view.setId(9L);
        view.setSandboxType("openclaw");
        when(service.buildRecordView(released)).thenReturn(view);
        when(config.getDcSystemConfigValueByCode(org.mockito.ArgumentMatchers.anyString())).thenReturn("");

        ResponseUtil response = controller.listRecords(Map.of("status", "RELEASED"));

        assertThat(response.getCode()).isEqualTo(ResponseUtil.SUCCESS);
        @SuppressWarnings("unchecked")
        List<SandboxRecordView> list = (List<SandboxRecordView>) ((Map<?, ?>) response.getData()).get("list");
        assertThat(list).hasSize(1);
        assertThat(list.get(0).getStatus()).isEqualTo("RELEASED");
        assertThat(list.get(0).getProviderStatus()).isEqualTo("RELEASED");
    }

    @Test
    void listRecords_appliesSandboxIdsAndStatusTogether() {
        setPlatformManager();
        SandboxController controller = controllerWithInventory();
        SsSandboxRecordMapper mapper = mock(SsSandboxRecordMapper.class);
        SandboxService service = mock(SandboxService.class);
        ReflectionTestUtils.setField(controller, "sandboxRecordMapper", mapper);
        ReflectionTestUtils.setField(controller, "sandboxService", service);
        when(mapper.selectInventoryPage(org.mockito.ArgumentMatchers.anyMap())).thenReturn(List.of());
        when(mapper.countInventory(org.mockito.ArgumentMatchers.anyMap())).thenReturn(0);

        controller.listRecords(Map.of("status", "RUNNING"));

        verify(mapper).selectInventoryPage(org.mockito.ArgumentMatchers.argThat(q ->
            "RUNNING".equals(q.get("status")) && List.of("live-id").equals(q.get("sandboxIds"))));
        verify(mapper).countInventory(org.mockito.ArgumentMatchers.argThat(q ->
            "RUNNING".equals(q.get("status")) && List.of("live-id").equals(q.get("sandboxIds"))));
    }

    private SandboxController controllerWithInventory() {
        SandboxController controller = new SandboxController();
        var inventory = mock(com.iwhalecloud.byai.gateway.sandbox.runtime.SandboxRuntimeInventory.class);
        when(inventory.current()).thenReturn(Map.of("live-id", "RUNNING"));
        ReflectionTestUtils.setField(controller, "runtimeInventory", inventory);
        return controller;
    }

    private void setPlatformManager() {
        UsersOrganization organization = new UsersOrganization();
        organization.setUserType(UserType.PLAT_MAN);
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserCode("adminvip");
        loginInfo.setUsersOrganizations(List.of(organization));
        CurrentUserHolder.setLoginInfo(loginInfo);
    }

    @Test
    void businessManagerSeesTheSameUserResourcesAsPlatformManagerButNotTenantResources() {
        setBusinessManager();
        SandboxController controller = controllerWithInventory();
        SsSandboxRecordMapper mapper = mock(SsSandboxRecordMapper.class);
        ReflectionTestUtils.setField(controller, "sandboxRecordMapper", mapper);
        when(mapper.selectInventoryPage(org.mockito.ArgumentMatchers.anyMap())).thenReturn(List.of());

        assertThat(controller.listRecords(Map.of("ownerScope", "USER")).getCode())
            .isEqualTo(ResponseUtil.SUCCESS);
        verify(mapper).selectInventoryPage(org.mockito.ArgumentMatchers.argThat(q -> "USER".equals(q.get("ownerScope")) && q.get("enterpriseId") == null));
        verify(mapper).countInventory(org.mockito.ArgumentMatchers.argThat(q -> q.get("enterpriseId") == null));
        assertThat(controller.listRecords(Map.of("ownerScope", "USER", "enterpriseId", "456")).getCode())
            .isEqualTo(ResponseUtil.SUCCESS);
        verify(mapper).selectInventoryPage(org.mockito.ArgumentMatchers.argThat(q -> Long.valueOf(456L).equals(q.get("enterpriseId"))));
        for (String scope : List.of("TENANT", "ALL")) {
            org.assertj.core.api.Assertions.assertThatThrownBy(() -> controller.listRecords(
                Map.of("ownerScope", scope)))
                .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
        }
    }

    @Test
    void businessManagerCannotModifyAnotherEnterpriseSandboxByRecordId() {
        setBusinessManager();
        SandboxController controller = controllerWithInventory();
        SsSandboxRecordMapper mapper = mock(SsSandboxRecordMapper.class);
        SandboxService service = mock(SandboxService.class);
        ReflectionTestUtils.setField(controller, "sandboxRecordMapper", mapper);
        ReflectionTestUtils.setField(controller, "sandboxService", service);
        SsSandboxRecord record = new SsSandboxRecord();
        record.setId(7L);
        record.setEnterpriseId(456L);
        when(mapper.selectById(7L)).thenReturn(record);

        org.assertj.core.api.Assertions.assertThatThrownBy(() -> controller.updateSandbox(
            Map.of("id", 7L, "autoRelease", 1)))
            .isInstanceOf(org.springframework.web.server.ResponseStatusException.class)
            .hasMessageContaining("sandbox.enterprise.denied");
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> controller.removeSandboxById(Map.of("id", 7L)))
            .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
        verifyNoInteractions(service);
    }

    private void setBusinessManager() {
        UsersOrganization organization = new UsersOrganization();
        organization.setUserType(UserType.BUSINESS_MAN);
        LoginInfo login = new LoginInfo();
        login.setUserCode("business-manager");
        login.setEnterpriseId(123L);
        login.setUsersOrganizations(List.of(organization));
        CurrentUserHolder.setLoginInfo(login);
    }

    @Test
    void businessManagerCanModifyAnAccessibleUserSandbox() {
        setBusinessManager();
        SandboxController controller = controllerWithInventory();
        SsSandboxRecordMapper mapper = mock(SsSandboxRecordMapper.class);
        SandboxService service = mock(SandboxService.class);
        ReflectionTestUtils.setField(controller, "sandboxRecordMapper", mapper);
        ReflectionTestUtils.setField(controller, "sandboxService", service);
        when(mapper.countEnterpriseUserSandbox(7L, 123L)).thenReturn(1);

        assertThat(controller.updateSandbox(Map.of("id", 7L, "autoRelease", 1)).getCode())
            .isEqualTo(ResponseUtil.SUCCESS);
        assertThat(controller.removeSandboxById(Map.of("id", 7L)).getCode()).isEqualTo(ResponseUtil.SUCCESS);
        verify(service).updateSandboxById(7L, 1);
        verify(service).removeSandboxById(7L);
        verify(service, never()).findRecordIdBySandboxIdAndStatus(org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.any());
    }

    @Test
    void removeSandboxById_prefersRecordIdWhenSandboxIdIsAlsoPresent() {
        setBusinessManager();
        SandboxController controller = new SandboxController();
        SsSandboxRecordMapper mapper = mock(SsSandboxRecordMapper.class);
        SandboxService service = mock(SandboxService.class);
        ReflectionTestUtils.setField(controller, "sandboxRecordMapper", mapper);
        ReflectionTestUtils.setField(controller, "sandboxService", service);
        when(mapper.countEnterpriseUserSandbox(7L, 123L)).thenReturn(1);

        assertThat(controller.removeSandboxById(Map.of("id", 7L, "sandboxId", "sandbox-other")).getCode())
            .isEqualTo(ResponseUtil.SUCCESS);
        verify(service).removeSandboxById(7L);
        verify(service, never()).findRecordIdBySandboxIdAndStatus(org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.any());
    }

    @Test
    void removeSandboxById_resolvesRunningRecordFromSandboxId() {
        setBusinessManager();
        SandboxController controller = new SandboxController();
        SsSandboxRecordMapper mapper = mock(SsSandboxRecordMapper.class);
        SandboxService service = mock(SandboxService.class);
        ReflectionTestUtils.setField(controller, "sandboxRecordMapper", mapper);
        ReflectionTestUtils.setField(controller, "sandboxService", service);
        when(service.findRecordIdBySandboxIdAndStatus("sandbox-9", "RUNNING")).thenReturn(9L);
        when(mapper.countEnterpriseUserSandbox(9L, 123L)).thenReturn(1);

        assertThat(controller.removeSandboxById(Map.of("sandboxId", "sandbox-9")).getCode())
            .isEqualTo(ResponseUtil.SUCCESS);
        verify(service).removeSandboxById(9L);
    }

    @Test
    void removeSandboxById_requiresIdOrSandboxIdAndRejectsUnknownRunningSandbox() {
        setBusinessManager();
        SandboxController controller = new SandboxController();
        SsSandboxRecordMapper mapper = mock(SsSandboxRecordMapper.class);
        SandboxService service = mock(SandboxService.class);
        ReflectionTestUtils.setField(controller, "sandboxRecordMapper", mapper);
        ReflectionTestUtils.setField(controller, "sandboxService", service);

        assertThat(controller.removeSandboxById(Map.of()).getMsg()).isEqualTo("id or sandboxId is required");
        assertThat(controller.removeSandboxById(Map.of("id", "abc", "sandboxId", "sandbox-9")).getMsg())
            .isEqualTo("id must be a valid number");
        when(service.findRecordIdBySandboxIdAndStatus("missing", "RUNNING")).thenReturn(null);
        assertThat(controller.removeSandboxById(Map.of("sandboxId", "missing")).getMsg())
            .isEqualTo("running sandbox record not found");
        verify(service, never()).removeSandboxById(org.mockito.ArgumentMatchers.any());
    }

    @Test
    void userResourcesStillRequireAnAdministrativeRole() {
        CurrentUserHolder.clearLoginInfo();
        SandboxController controller = controllerWithInventory();
        SsSandboxRecordMapper mapper = mock(SsSandboxRecordMapper.class);
        ReflectionTestUtils.setField(controller, "sandboxRecordMapper", mapper);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> controller.listRecords(Map.of()))
            .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
        verifyNoInteractions(mapper);
    }

    @Test
    void saveServiceSpec_defaultsAutoStartToEnabledForLegacyClients() {
        SandboxController controller = controllerWithInventory();
        SandboxServiceSpecEntityMapper mapper = mock(SandboxServiceSpecEntityMapper.class);
        ReflectionTestUtils.setField(controller, "sandboxServiceSpecEntityMapper", mapper);
        when(mapper.selectById("openclaw")).thenReturn(null);

        ResponseUtil response = controller.saveServiceSpec(Map.of(
            "serviceKey", "openclaw",
            "specJson", "{}",
            "templateJson", "{}"
        ));

        assertThat(response.getCode()).isEqualTo(ResponseUtil.SUCCESS);
        verify(mapper).insertSpec("openclaw", "{}", "{}", 1);
    }

    @Test
    void saveServiceSpec_updatesExplicitAutoStartValue() {
        SandboxController controller = controllerWithInventory();
        SandboxServiceSpecEntityMapper mapper = mock(SandboxServiceSpecEntityMapper.class);
        ReflectionTestUtils.setField(controller, "sandboxServiceSpecEntityMapper", mapper);
        SandboxServiceSpecEntity existing = new SandboxServiceSpecEntity();
        existing.setServiceKey("byclaw-dsh");
        when(mapper.selectById("byclaw-dsh")).thenReturn(existing);

        ResponseUtil response = controller.saveServiceSpec(Map.of(
            "serviceKey", "byclaw-dsh",
            "specJson", "{}",
            "enabled", false
        ));

        assertThat(response.getCode()).isEqualTo(ResponseUtil.SUCCESS);
        verify(mapper).updateSpec("byclaw-dsh", "{}", null, 0);
    }

    @Test
    void removeSandbox_targetsOneServiceWhenSandboxTypeIsProvided() {
        SandboxController controller = controllerWithInventory();
        SandboxService sandboxService = mock(SandboxService.class);
        ReflectionTestUtils.setField(controller, "sandboxService", sandboxService);

        ResponseUtil response = controller.removeSandbox(Map.of(
            "userCode", "user001",
            "sandboxType", "byclaw-dsh"
        ));

        assertThat(response.getCode()).isEqualTo(ResponseUtil.SUCCESS);
        verify(sandboxService).removeSandbox("user001", null, "byclaw-dsh");
    }

    @Test
    void navigateBrowser_logsUnexpectedFailureWithRequestContextAndStackTrace() {
        SandboxController controller = controllerWithInventory();
        SandboxBrowserNavigationService navigationService = mock(SandboxBrowserNavigationService.class);
        ReflectionTestUtils.setField(controller, "sandboxBrowserNavigationService", navigationService);
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserCode("user001");
        CurrentUserHolder.setLoginInfo(loginInfo);
        doThrow(new IllegalStateException("daemon failed https://example.com?ticket=secret-error"))
            .when(navigationService)
            .navigate("user001", "sandbox-1", "https://example.com/login?ticket=private", "operation-account-1");
        MessageSource messageSource = mock(MessageSource.class);
        when(messageSource.getMessage(org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(java.util.Locale.class)))
            .thenReturn("navigation failed");
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messageSource);

        Logger logger = (Logger)LoggerFactory.getLogger(SandboxController.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        logger.addAppender(appender);
        appender.start();
        try {
            controller.navigateBrowser(Map.of(
                "sandboxId", "sandbox-1",
                "targetUrl", "https://example.com/login?ticket=private",
                "sessionKey", "operation-account-1"
            ));

            assertThat(appender.list).anySatisfy(event -> {
                assertThat(event.getFormattedMessage())
                    .contains("stage=CONTROLLER_FAILURE", "userCode=user001", "sandboxId=sandbox-1")
                    .contains("sessionKey=operation-account-1", "target=https://example.com/login")
                    .contains("stackTrace=java.lang.IllegalStateException")
                    .doesNotContain("ticket=private", "secret-error");
                assertThat(event.getThrowableProxy()).isNull();
            });
        } finally {
            logger.detachAppender(appender);
            appender.stop();
            ReflectionTestUtils.setField(I18nUtil.class, "messageSource", null);
        }
    }
}
