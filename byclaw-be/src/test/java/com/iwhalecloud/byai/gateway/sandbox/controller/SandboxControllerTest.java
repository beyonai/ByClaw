package com.iwhalecloud.byai.gateway.sandbox.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.Date;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;

class SandboxControllerTest {

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void getSandboxInfo_returnsGatewayToken() {
        SandboxService sandboxService = mock(SandboxService.class);
        SandboxController controller = new SandboxController();
        ReflectionTestUtils.setField(controller, "sandboxService", sandboxService);
        when(sandboxService.sandboxInfo("user001")).thenReturn(List.of(SandboxInfo.builder()
            .sandboxId("sandbox-1")
            .sandboxType("openclaw")
            .endpoints(List.of("http://host/proxy/18789/chat?token=0123456789abcdef0123456789abcdef"))
            .gatewayToken("0123456789abcdef0123456789abcdef")
            .build()));

        ResponseUtil response = controller.getSandboxIdByUserCode(Map.of("userCode", "user001"));

        assertThat(response.getCode()).isEqualTo(ResponseUtil.SUCCESS);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> data = (List<Map<String, Object>>) response.getData();
        assertThat(data).hasSize(1);
        assertThat(data.get(0))
            .containsEntry("token", "0123456789abcdef0123456789abcdef")
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
        SsSandboxRecordMapper sandboxRecordMapper = mock(SsSandboxRecordMapper.class);
        ReflectionTestUtils.setField(controller, "sandboxRecordMapper", sandboxRecordMapper);

        SsSandboxRecord record = new SsSandboxRecord();
        record.setId(1L);
        record.setEndpoint(
            "{\"openclaw\":\"http://host/proxy/18789/chat?token=abc\",\"ui\":\"http://host/proxy/3000?token=abc\"}");
        record.setCreateTime(new Date());
        when(sandboxRecordMapper.selectByPage(null, null, 0, 20)).thenReturn(List.of(record));
        when(sandboxRecordMapper.countByCondition(null, null)).thenReturn(1);

        ResponseUtil response = controller.listRecords(Map.of());

        assertThat(response.getCode()).isEqualTo(ResponseUtil.SUCCESS);
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) response.getData();
        @SuppressWarnings("unchecked")
        List<SsSandboxRecord> list = (List<SsSandboxRecord>) data.get("list");
        assertThat(list).hasSize(1);
        assertThat(list.get(0).getEndpoint()).isEqualTo("http://host/proxy/18789/chat?token=abc");
    }
}
