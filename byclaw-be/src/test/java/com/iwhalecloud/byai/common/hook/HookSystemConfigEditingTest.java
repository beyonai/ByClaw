package com.iwhalecloud.byai.common.hook;

import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.manager.application.service.staticdata.SystemConfigApplicationService;
import com.iwhalecloud.byai.manager.domain.staticdata.service.SystemConfigService;
import com.iwhalecloud.byai.manager.entity.staticdata.ByaiSystemConfig;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

/** 沿用系统配置详情和编辑入口，不为 Hook 文档引入新的读取屏蔽或角色限制。 */
class HookSystemConfigEditingTest {
    @Test void existingManagementApiReturnsAndUpdatesTheRawJsonDocument() {
        var stored = new ByaiSystemConfig();
        stored.setParamId(1L);
        stored.setParamCode("BYCLAW_HOOKS_CONFIG");
        stored.setParamType("json");
        stored.setParamValue("{\"byclaw\":{\"hooks\":{\"enabled\":false}}}");
        var database = mock(SystemConfigService.class);
        when(database.findById(1L)).thenReturn(stored);
        var application = new SystemConfigApplicationService();
        ReflectionTestUtils.setField(application, "systemConfigService", database);
        assertThat(application.getSystemConfigById(1L)).isSameAs(stored);
        assertThat(application.getSystemConfigById(1L).getParamValue()).isEqualTo(stored.getParamValue());
        stored.setParamValue("{\"byclaw\":{\"hooks\":{\"enabled\":true}}}");
        try (var redis = mockStatic(RedisUtil.class)) {
            application.updateSystemConfig(stored);
            verify(database).updateById(stored);
            assertThat(stored.getParamType()).isEqualTo("json");
        }
    }
}
