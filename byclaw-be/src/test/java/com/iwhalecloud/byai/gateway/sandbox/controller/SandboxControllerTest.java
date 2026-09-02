package com.iwhalecloud.byai.gateway.sandbox.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Date;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.gateway.sandbox.mapper.SandboxServiceSpecEntityMapper;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxRecordView;
import com.iwhalecloud.byai.gateway.sandbox.persistence.SandboxServiceSpecEntity;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;

class SandboxControllerTest {

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void getSandboxInfo_returnsGatewayToken() {
        SandboxService sandboxService = mock(SandboxService.class);
        SsSandboxRecordMapper sandboxRecordMapper = mock(SsSandboxRecordMapper.class);
        SandboxController controller = new SandboxController();
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
    void renewSandbox_returnsRenewedSandboxInfo() {
        SandboxService sandboxService = mock(SandboxService.class);
        SandboxController controller = new SandboxController();
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
        SandboxController controller = new SandboxController();
        SandboxService sandboxService = mock(SandboxService.class);
        SsSandboxRecordMapper sandboxRecordMapper = mock(SsSandboxRecordMapper.class);
        ByaiSystemConfigService byaiSystemConfigService = mock(ByaiSystemConfigService.class);
        ReflectionTestUtils.setField(controller, "sandboxService", sandboxService);
        ReflectionTestUtils.setField(controller, "sandboxRecordMapper", sandboxRecordMapper);
        ReflectionTestUtils.setField(controller, "byaiSystemConfigService", byaiSystemConfigService);

        SsSandboxRecord record = new SsSandboxRecord();
        record.setId(1L);
        record.setEndpoint(
            "{\"openclaw\":\"http://host/proxy/18789/chat?token=abc\",\"ui\":\"http://host/proxy/3000?token=abc\"}");
        record.setCreateTime(new Date());
        when(sandboxRecordMapper.selectByPage(null, null, 0, 20)).thenReturn(List.of(record));
        SandboxRecordView view = new SandboxRecordView();
        view.setId(1L);
        view.setEndpoint(record.getEndpoint());
        view.setWorkerOnline(false);
        when(sandboxService.buildRecordView(record)).thenReturn(view);
        when(sandboxRecordMapper.countByCondition(null, null)).thenReturn(1);
        when(byaiSystemConfigService.getDcSystemConfigValueByCode("WEB_BASE_URL")).thenReturn("");

        ResponseUtil response = controller.listRecords(Map.of());

        assertThat(response.getCode()).isEqualTo(ResponseUtil.SUCCESS);
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) response.getData();
        @SuppressWarnings("unchecked")
        List<SandboxRecordView> list = (List<SandboxRecordView>) data.get("list");
        assertThat(list).hasSize(1);
        assertThat(list.get(0).getEndpoint()).isEqualTo("http://host/proxy/18789/chat?token=abc");
        assertThat(list.get(0).getWorkerOnline()).isFalse();
    }

    @Test
    void saveServiceSpec_defaultsAutoStartToEnabledForLegacyClients() {
        SandboxController controller = new SandboxController();
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
        SandboxController controller = new SandboxController();
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
        SandboxController controller = new SandboxController();
        SandboxService sandboxService = mock(SandboxService.class);
        ReflectionTestUtils.setField(controller, "sandboxService", sandboxService);

        ResponseUtil response = controller.removeSandbox(Map.of(
            "userCode", "user001",
            "sandboxType", "byclaw-dsh"
        ));

        assertThat(response.getCode()).isEqualTo(ResponseUtil.SUCCESS);
        verify(sandboxService).removeSandbox("user001", null, "byclaw-dsh");
    }
}
