package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.common.constants.Constants;
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
class AssistantChatServiceTest {

    private AssistantChatService assistantChatService;

    @Mock
    private SsResourceService ssResourceService;

    @BeforeEach
    void setUp() {
        assistantChatService = new AssistantChatService();
        ReflectionTestUtils.setField(assistantChatService, "ssResourceService", ssResourceService);
    }

    /**
     * 默认超级助手已改为真实数字员工资源，但下游仍以 agentId=null 表示 main 路由。
     *
     * @author qin.guoquan
     * @date 2026-05-09 15:20:00
     */
    @Test
    void normalizeDefaultSuperAssistantAgentId_clearsAgentIdWhenResourceCodeEndsWithMain() {
        AssistantChatDto assistantChatDto = new AssistantChatDto();
        assistantChatDto.setAgentId(1001L);
        SsResource resource = new SsResource();
        resource.setResourceId(1001L);
        resource.setResourceBizType(Constants.ResourceBizType.DIG_EMPLOYEE);
        resource.setResourceCode("user001_main");
        when(ssResourceService.findById(1001L)).thenReturn(resource);

        ReflectionTestUtils.invokeMethod(assistantChatService, "normalizeDefaultSuperAssistantAgentId", assistantChatDto);

        assertThat(assistantChatDto.getAgentId()).isNull();
    }

    /**
     * 普通数字员工也会传真实 resourceId，不能因为进入聊天流程而被误判成超级助手。
     *
     * @author qin.guoquan
     * @date 2026-05-09 15:20:00
     */
    @Test
    void normalizeDefaultSuperAssistantAgentId_keepsRegularDigitalEmployeeAgentId() {
        AssistantChatDto assistantChatDto = new AssistantChatDto();
        assistantChatDto.setAgentId(1002L);
        SsResource resource = new SsResource();
        resource.setResourceId(1002L);
        resource.setResourceBizType(Constants.ResourceBizType.DIG_EMPLOYEE);
        resource.setResourceCode("employee_1002");
        when(ssResourceService.findById(1002L)).thenReturn(resource);

        ReflectionTestUtils.invokeMethod(assistantChatService, "normalizeDefaultSuperAssistantAgentId", assistantChatDto);

        assertThat(assistantChatDto.getAgentId()).isEqualTo(1002L);
    }
}
