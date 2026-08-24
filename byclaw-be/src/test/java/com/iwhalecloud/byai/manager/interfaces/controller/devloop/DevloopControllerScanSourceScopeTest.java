package com.iwhalecloud.byai.manager.interfaces.controller.devloop;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.HashMap;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.manager.application.service.devloop.DevloopApplicationService;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;

/**
 * 锁定 /source/list 的两条作用域边界：
 * 1. 应用级自动化页不传 projectId 表示跨项目查询，必须传 null 给下游。
 * MapParamUtil.getLongValue 的单参重载缺省返回 0L，一旦漏掉显式默认值，
 * 下游会按 project_id = 0 过滤，渠道列表整体查不出数据。
 * 2. onlyMine 缺省必须是 false，项目渠道页才能继续看到全项目的渠道。
 */
class DevloopControllerScanSourceScopeTest {

    private DevloopApplicationService applicationService;

    private DevloopController controller;

    private ResponseUtil<PageInfo<Map<String, Object>>> expected;

    @BeforeEach
    void setUp() {
        applicationService = mock(DevloopApplicationService.class);
        controller = new DevloopController();
        ReflectionTestUtils.setField(controller, "applicationService", applicationService);
        expected = ResponseUtil.successResponse(new PageInfo<Map<String, Object>>());
    }

    private ArgumentCaptor<Long> captureListedProjectId(Map<String, Object> params) {
        ArgumentCaptor<Long> projectIdCaptor = ArgumentCaptor.forClass(Long.class);
        // 只对 projectId 断言：keyword 缺省是空串、分页有默认值，写死会让用例脆。
        when(applicationService.listScanSources(projectIdCaptor.capture(), anyString(), anyBoolean(), anyInt(),
            anyInt())).thenReturn(expected);

        assertThat(controller.listScanSources(params)).isSameAs(expected);
        return projectIdCaptor;
    }

    private ArgumentCaptor<Boolean> captureOnlyMine(Map<String, Object> params) {
        ArgumentCaptor<Boolean> onlyMineCaptor = ArgumentCaptor.forClass(Boolean.class);
        // projectId 用 isNull()/anyLong() 两个桩覆盖，避免 anyLong() 漏掉不传 projectId 的调用。
        when(applicationService.listScanSources(isNull(), anyString(), onlyMineCaptor.capture(), anyInt(), anyInt()))
            .thenReturn(expected);
        when(applicationService.listScanSources(anyLong(), anyString(), onlyMineCaptor.capture(), anyInt(), anyInt()))
            .thenReturn(expected);

        assertThat(controller.listScanSources(params)).isSameAs(expected);
        return onlyMineCaptor;
    }

    @Test
    void omittedProjectIdListsAcrossProjectsInsteadOfFilteringOnProjectZero() {
        ArgumentCaptor<Long> projectId = captureListedProjectId(new HashMap<>());

        assertThat(projectId.getValue()).isNull();
    }

    @Test
    void explicitProjectIdStaysScopedToThatProject() {
        Map<String, Object> params = new HashMap<>();
        params.put("projectId", 11036413L);

        ArgumentCaptor<Long> projectId = captureListedProjectId(params);

        assertThat(projectId.getValue()).isEqualTo(11036413L);
    }

    @Test
    void omittedOnlyMineKeepsProjectChannelPageVisibleAcrossCreators() {
        Map<String, Object> params = new HashMap<>();
        params.put("projectId", 11036413L);

        ArgumentCaptor<Boolean> onlyMine = captureOnlyMine(params);

        assertThat(onlyMine.getValue()).isFalse();
    }

    @Test
    void onlyMineNarrowsAutomationPageToCurrentCreator() {
        Map<String, Object> params = new HashMap<>();
        params.put("onlyMine", true);

        ArgumentCaptor<Boolean> onlyMine = captureOnlyMine(params);

        assertThat(onlyMine.getValue()).isTrue();
    }
}
