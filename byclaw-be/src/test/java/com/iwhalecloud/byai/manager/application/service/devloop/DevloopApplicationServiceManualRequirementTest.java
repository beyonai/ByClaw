package com.iwhalecloud.byai.manager.application.service.devloop;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.MessageSource;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.context.support.StaticMessageSource;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
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

    private MessageSource originalMessageSource;

    @BeforeEach
    void setUp() {
        // I18nUtil 持有静态 MessageSource，测试需独立注入并在每个用例结束后还原，避免影响其他测试。
        originalMessageSource = (MessageSource) ReflectionTestUtils.getField(I18nUtil.class, "messageSource");
        StaticMessageSource messageSource = new StaticMessageSource();
        messageSource.addMessage("devloop.manualRequirement.source.name", Locale.US, "Manual entry");
        messageSource.addMessage("devloop.manualRequirement.origin.customerFeedback", Locale.US, "Customer feedback");
        messageSource.addMessage("devloop.manualRequirement.content.source", Locale.US, "Source: {0}");
        messageSource.addMessage("devloop.manualRequirement.content.branch", Locale.US, "Affected branch: {0}");
        messageSource.addMessage("devloop.manualRequirement.content.product", Locale.US, "Product requirement:");
        messageSource.addMessage("devloop.manualRequirement.content.original", Locale.US, "Original requirement:");
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messageSource);
        LocaleContextHolder.setLocale(Locale.US);

        service = new DevloopApplicationService();
        ReflectionTestUtils.setField(service, "scanSourceService", scanSourceService);
        ReflectionTestUtils.setField(service, "scanLogService", scanLogService);
    }

    @AfterEach
    void tearDown() {
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", originalMessageSource);
        LocaleContextHolder.resetLocaleContext();
    }

    @Test
    void createsManualRequirementUsingInternalDisabledSource() {
        ScanSource source = new ScanSource();
        source.setSourceId(300L);
        source.setSourceName("manual");
        source.setSourceType("manual");
        source.setEnabled("0");
        when(scanSourceService.listByProjectId(203L)).thenReturn(List.of(source));

        ScanLog log = new ScanLog();
        log.setLogId(400L);
        when(scanLogService.createLog(300L, 203L)).thenReturn(log);
        when(scanLogService.createItem(eq(400L), eq(300L), eq("Improve login flow"), any(), any(), eq(null),
            eq("created")))
            .thenAnswer(invocation -> {
                ScanLogItem item = new ScanLogItem();
                item.setItemId(500L);
                item.setSourceId(300L);
                item.setTitle("Improve login flow");
                item.setContent(invocation.getArgument(3));
                item.setOriginId(invocation.getArgument(4));
                item.setAction("created");
                return item;
            });

        ManualRequirementDTO request = new ManualRequirementDTO();
        request.setProjectId(203L);
        request.setSourceType("customer_feedback");
        request.setBranch("develop");
        request.setTitle("Improve login flow");
        request.setOriginalContent("Customers report that the login flow has too many steps.");
        request.setProductContent("Simplify the flow while retaining security checks.");

        ResponseUtil<java.util.Map<String, Object>> response = service.createManualRequirement(request);

        assertThat(response.isSuccess()).isTrue();
        assertThat(response.getData()).containsEntry("itemId", 500L).containsEntry("sourceType", "manual")
            .containsEntry("manualSourceType", "customer_feedback").containsEntry("branch", "develop")
            .containsEntry("sourceName", "Manual entry")
            .containsEntry("originalContent", "Customers report that the login flow has too many steps.")
            .containsEntry("productContent", "Simplify the flow while retaining security checks.");
        assertThat(response.getData().get("content")).asString().contains("Affected branch: develop")
            .contains("Original requirement:");
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
        dingtalk.setSourceName("Test group");
        when(scanSourceService.listByProjectId(203L)).thenReturn(List.of(manual, dingtalk));

        ResponseUtil<List<java.util.Map<String, Object>>> response = service.listScanSources(203L);

        assertThat(response.isSuccess()).isTrue();
        assertThat(response.getData()).hasSize(1);
        Map<String, Object> channel = response.getData().get(0);
        assertThat(channel).containsEntry("sourceId", 2L).containsEntry("sourceType", "dingtalk");
    }
}
