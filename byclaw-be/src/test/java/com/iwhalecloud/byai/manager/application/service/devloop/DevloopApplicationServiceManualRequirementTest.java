package com.iwhalecloud.byai.manager.application.service.devloop;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.manager.domain.devloop.service.ScanLogService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ScanSourceService;
import com.iwhalecloud.byai.manager.dto.devloop.ManualRequirementDTO;
import com.iwhalecloud.byai.manager.entity.devloop.ScanLog;
import com.iwhalecloud.byai.manager.entity.devloop.ScanLogItem;
import com.iwhalecloud.byai.manager.entity.devloop.ScanSource;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;

@ExtendWith(MockitoExtension.class)
class DevloopApplicationServiceManualRequirementTest {

    @Mock
    private ScanSourceService scanSourceService;

    @Mock
    private ScanLogService scanLogService;

    private DevloopApplicationService service;

    @BeforeEach
    void setUp() {
        service = new DevloopApplicationService();
        ReflectionTestUtils.setField(service, "scanSourceService", scanSourceService);
        ReflectionTestUtils.setField(service, "scanLogService", scanLogService);
    }

    @Test
    void createsManualRequirementUsingInternalDisabledSource() {
        ScanSource source = new ScanSource();
        source.setSourceId(300L);
        source.setSourceName("手工录入");
        source.setSourceType("manual");
        source.setEnabled("0");
        when(scanSourceService.listByProjectId(203L)).thenReturn(List.of(source));

        ScanLog log = new ScanLog();
        log.setLogId(400L);
        when(scanLogService.createLog(300L, 203L)).thenReturn(log);
        when(scanLogService.createItem(eq(400L), eq(300L), eq("优化登录流程"), any(), any(), eq(null), eq("created")))
            .thenAnswer(invocation -> {
                ScanLogItem item = new ScanLogItem();
                item.setItemId(500L);
                item.setSourceId(300L);
                item.setTitle("优化登录流程");
                item.setContent(invocation.getArgument(3));
                item.setOriginId(invocation.getArgument(4));
                item.setAction("created");
                return item;
            });

        ManualRequirementDTO request = new ManualRequirementDTO();
        request.setProjectId(203L);
        request.setSourceType("customer_feedback");
        request.setBranch("develop");
        request.setTitle("优化登录流程");
        request.setOriginalContent("客户反馈登录步骤过多。");
        request.setProductContent("简化登录流程并保留安全校验。");

        ResponseUtil<java.util.Map<String, Object>> response = service.createManualRequirement(request);

        assertThat(response.isSuccess()).isTrue();
        assertThat(response.getData()).containsEntry("itemId", 500L).containsEntry("sourceType", "manual")
            .containsEntry("manualSourceType", "customer_feedback").containsEntry("branch", "develop")
            .containsEntry("originalContent", "客户反馈登录步骤过多。").containsEntry("productContent", "简化登录流程并保留安全校验。");
        assertThat(response.getData().get("content")).asString().contains("影响分支：develop").contains("原始需求");
        verify(scanLogService).completeLog(400L, 1, 1);
        verify(scanSourceService, never()).create(any());
    }

    @Test
    void excludesInternalManualSourceFromChannelConfiguration() {
        ScanSource manual = new ScanSource();
        manual.setSourceId(1L);
        manual.setSourceType("manual");

        ScanSource dingtalk = new ScanSource();
        dingtalk.setSourceId(2L);
        dingtalk.setSourceType("dingtalk");
        dingtalk.setSourceName("测试群");
        when(scanSourceService.listByProjectId(203L)).thenReturn(List.of(manual, dingtalk));

        ResponseUtil<List<java.util.Map<String, Object>>> response = service.listScanSources(203L);

        assertThat(response.isSuccess()).isTrue();
        assertThat(response.getData()).hasSize(1);
        Map<String, Object> channel = response.getData().get(0);
        assertThat(channel).containsEntry("sourceId", 2L).containsEntry("sourceType", "dingtalk");
    }
}
