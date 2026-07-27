package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.constants.resource.WorkerAgentType;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

@ExtendWith(MockitoExtension.class)
class TargetAgentResolverTest {

    private TargetAgentResolver targetAgentResolver;

    @Mock
    private SsResourceService ssResourceService;

    @BeforeEach
    void setUp() {
        targetAgentResolver = new TargetAgentResolver();
        ReflectionTestUtils.setField(targetAgentResolver, "ssResourceService", ssResourceService);
    }

    /**
     * 已迁移到 BY_SUPER 的默认超级助手必须保留真实资源 ID，供后续读取 worker_agent_type。
     */
    @Test
    void resolveAgentIdWithAssistantChatDto_keepsAgentIdWhenDefaultSuperAssistantRoutesToBySuper() {
        AssistantChatDto assistantChatDto = new AssistantChatDto();
        assistantChatDto.setAgentId(1001L);
        SsResource resource = new SsResource();
        resource.setResourceId(1001L);
        resource.setResourceBizType(Constants.ResourceBizType.DIG_EMPLOYEE);
        resource.setResourceCode("user001_main");
        resource.setWorkerAgentType(WorkerAgentType.BY_SUPER.getCode());
        when(ssResourceService.findById(1001L)).thenReturn(resource);

        Long agentId = targetAgentResolver.resolveAgentId(assistantChatDto);

        assertThat(agentId).isEqualTo(1001L);
    }

    @Test
    void resolveAgentIdWithAssistantChatDto_keepsLegacyMainRouteBeforeResourceMigration() {
        AssistantChatDto assistantChatDto = new AssistantChatDto();
        assistantChatDto.setAgentId(1003L);
        SsResource resource = new SsResource();
        resource.setResourceId(1003L);
        resource.setResourceBizType(Constants.ResourceBizType.DIG_EMPLOYEE);
        resource.setResourceCode("user003_main");
        resource.setWorkerAgentType(WorkerAgentType.BYCLAW_EXE.getCode());
        when(ssResourceService.findById(1003L)).thenReturn(resource);

        Long agentId = targetAgentResolver.resolveAgentId(assistantChatDto);

        assertThat(agentId).isNull();
    }

    /**
     * 普通数字员工也会传真实 resourceId，不能因为进入聊天流程而被误判成超级助手。
     *
     * @author qin.guoquan
     * @date 2026-05-09 15:20:00
     */
    @Test
    void resolveAgentIdWithLong_keepsRegularDigitalEmployeeAgentId() {
        SsResource resource = new SsResource();
        resource.setResourceId(1002L);
        resource.setResourceBizType(Constants.ResourceBizType.DIG_EMPLOYEE);
        resource.setResourceCode("employee_1002");
        when(ssResourceService.findById(1002L)).thenReturn(resource);

        Long agentId = targetAgentResolver.resolveAgentId(1002L);

        assertThat(agentId).isEqualTo(1002L);
    }
}
