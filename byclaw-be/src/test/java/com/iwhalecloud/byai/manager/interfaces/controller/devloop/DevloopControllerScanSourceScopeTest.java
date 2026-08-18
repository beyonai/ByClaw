package com.iwhalecloud.byai.manager.interfaces.controller.devloop;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.HashMap;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.manager.application.service.devloop.DevloopApplicationService;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;

/**
 * 锁定 /source/list 的项目作用域边界：
 * 应用级自动化页不传 projectId 表示跨项目查询，必须传 null 给下游。
 * MapParamUtil.getLongValue 的单参重载缺省返回 0L，一旦漏掉显式默认值，
 * 下游会按 project_id = 0 过滤，渠道列表整体查不出数据。
 */
class DevloopControllerScanSourceScopeTest {

    private ArgumentCaptor<Long> captureListedProjectId(Map<String, Object> params) {
        DevloopApplicationService applicationService = mock(DevloopApplicationService.class);
        DevloopController controller = new DevloopController();
        ReflectionTestUtils.setField(controller, "applicationService", applicationService);

        ArgumentCaptor<Long> projectIdCaptor = ArgumentCaptor.forClass(Long.class);
        ResponseUtil<PageInfo<Map<String, Object>>> expected =
            ResponseUtil.successResponse(new PageInfo<Map<String, Object>>());
        // 只对 projectId 断言：keyword 缺省是空串、分页有默认值，写死会让用例脆。
        when(applicationService.listScanSources(projectIdCaptor.capture(), anyString(), anyInt(), anyInt()))
            .thenReturn(expected);

        assertThat(controller.listScanSources(params)).isSameAs(expected);
        return projectIdCaptor;
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
}
