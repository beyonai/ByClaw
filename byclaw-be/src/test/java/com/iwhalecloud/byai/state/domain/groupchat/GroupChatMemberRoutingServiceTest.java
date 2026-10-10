package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;
import java.util.List;
import java.util.Map;
import com.iwhalecloud.byai.manager.application.service.user.UserPrivateParamCacheReader;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.state.domain.chat.service.SystemParamTargetAgentResolver;
import com.iwhalecloud.byai.state.domain.chat.service.TargetAgentResolver;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatMemberRoutingService;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class GroupChatMemberRoutingServiceTest {
    @Test
    void memberRoutesFollowPersonalAndGlobalChatPolicyWithoutChangingResourceConfiguration() {
        var resources = mock(SsResourceService.class);
        var personal = mock(UserPrivateParamCacheReader.class);
        var global = mock(ByaiSystemConfigService.class);
        var system = new SystemParamTargetAgentResolver(global, personal, resources);
        var routes = new TargetAgentResolver();
        ReflectionTestUtils.setField(routes, "systemParamTargetAgentResolver", system);
        var service = new GroupChatMemberRoutingService(resources, routes);
        var coordinator = new SsResource(); coordinator.setWorkerAgentType("HARNESS");
        var employee = new SsResource(); employee.setWorkerAgentType("BYCLAW_EXE");
        when(resources.findById(9L)).thenReturn(coordinator);
        when(resources.findById(2L)).thenReturn(employee);
        Map<String, Object> scope = Map.of("coordinatorAgentId", "9", "allowedAgentIds", List.of("2"));
        when(global.getDcSystemConfigValueByCode("ENABLE_DSH")).thenReturn("1");
        assertThat(service.withRoutes(scope, "u").get("effectiveWorkerAgentTypes"))
            .isEqualTo(Map.of("9", "BYCLAW_DSH_u", "2", "BYCLAW_DSH_u"));
        when(personal.getValue("u", "ENABLE_DSH")).thenReturn("0");
        assertThat(service.withRoutes(scope, "u").get("effectiveWorkerAgentTypes"))
            .isEqualTo(Map.of("9", "BYCLAW_DSH_u", "2", "BYCLAW_EXE_u"));
        assertThat(employee.getWorkerAgentType()).isEqualTo("BYCLAW_EXE");
        assertThat(scope).doesNotContainKey("effectiveWorkerAgentTypes");
    }
}
