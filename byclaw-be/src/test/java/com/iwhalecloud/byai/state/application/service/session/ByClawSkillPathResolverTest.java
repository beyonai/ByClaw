package com.iwhalecloud.byai.state.application.service.session;

import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.staticdata.service.SystemConfigService;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ByClawSkillPathResolverTest {

    private static final String USER_CODE = "adminvip";

    private static final Long RESOURCE_ID = 10000417L;

    @Mock
    private SystemConfigService systemConfigService;

    @Mock
    private SsResourceService ssResourceService;

    @Mock
    private SsResExtDigEmployeeService ssResExtDigEmployeeService;

    private ByClawSkillPathResolver resolver;

    @BeforeEach
    void setUp() {
        resolver = new ByClawSkillPathResolver();
        ReflectionTestUtils.setField(resolver, "systemConfigService", systemConfigService);
        ReflectionTestUtils.setField(resolver, "ssResourceService", ssResourceService);
        ReflectionTestUtils.setField(resolver, "ssResExtDigEmployeeService", ssResExtDigEmployeeService);
    }

    @Test
    void shouldResolveConfiguredSkillPathByOwnerTypeAndAgentType() {
        when(ssResourceService.findById(RESOURCE_ID)).thenReturn(resource("employee_10000417", "enterprise"));
        when(ssResExtDigEmployeeService.findById(RESOURCE_ID)).thenReturn(ext("006"));
        when(systemConfigService.getStringParamValueByCode("TEMPLATE_DIGITAL_EMPLOYEE")).thenReturn("""
            [
              {"ownerType":"enterprise","agentType":"006","skillPath":"/.ByKC/{userCode}/agent_{resourceId}/skills"}
            ]
            """);

        String result = resolver.resolveSkillRootPrefix(USER_CODE, RESOURCE_ID);

        assertEquals("/.ByKC/adminvip/agent_10000417/skills/", result);
    }

    @Test
    void shouldFallbackToAgentDefaultPathWhenConfigSkillPathBlank() {
        when(ssResourceService.findById(RESOURCE_ID)).thenReturn(resource("employee_10000417", "personal"));
        when(ssResExtDigEmployeeService.findById(RESOURCE_ID)).thenReturn(ext("001"));
        when(systemConfigService.getStringParamValueByCode("TEMPLATE_DIGITAL_EMPLOYEE")).thenReturn("""
            [
              {"ownerType":"personal","agentType":"001","skillPath":""}
            ]
            """);

        String result = resolver.resolveSkillRootPrefix(USER_CODE, RESOURCE_ID);

        assertEquals("/.openclaw/workspace-baiying-agent-10000417/skills/", result);
    }

    @Test
    void shouldFallbackToSuperAssistantDefaultPathWhenResourceCodeEndsWithMain() {
        when(ssResourceService.findById(RESOURCE_ID)).thenReturn(resource("adminvip_main", "enterprise"));
        when(ssResExtDigEmployeeService.findById(RESOURCE_ID)).thenReturn(ext("001"));
        when(systemConfigService.getStringParamValueByCode("TEMPLATE_DIGITAL_EMPLOYEE")).thenReturn("""
            [
              {"ownerType":"enterprise","agentType":"001","skillPath":""}
            ]
            """);

        String result = resolver.resolveSkillRootPrefix(USER_CODE, RESOURCE_ID);

        assertEquals("/.openclaw/workspace/skills/", result);
    }

    @Test
    void shouldFallbackToDefaultPathWhenTemplateJsonInvalid() {
        when(ssResourceService.findById(RESOURCE_ID)).thenReturn(resource("employee_10000417", "enterprise"));
        when(ssResExtDigEmployeeService.findById(RESOURCE_ID)).thenReturn(ext("006"));
        when(systemConfigService.getStringParamValueByCode("TEMPLATE_DIGITAL_EMPLOYEE")).thenReturn("{bad json");

        String result = resolver.resolveSkillRootPrefix(USER_CODE, RESOURCE_ID);

        assertEquals("/.openclaw/workspace-baiying-agent-10000417/skills/", result);
    }

    private SsResource resource(String resourceCode, String ownerType) {
        SsResource resource = new SsResource();
        resource.setResourceCode(resourceCode);
        resource.setOwnerType(ownerType);
        return resource;
    }

    private SsResExtDigEmployee ext(String agentType) {
        SsResExtDigEmployee ext = new SsResExtDigEmployee();
        ext.setAgentType(agentType);
        return ext;
    }
}
