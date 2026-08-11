package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.session.enums.SessionType;
import com.iwhalecloud.byai.state.domain.session.service.SessionTitleService;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
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

    @Mock
    private SessionTitleService sessionTitleService;

    @BeforeEach
    void setUp() {
        assistantChatService = new AssistantChatService();
        ReflectionTestUtils.setField(assistantChatService, "ssResourceService", ssResourceService);
        ReflectionTestUtils.setField(assistantChatService, "sessionTitleService", sessionTitleService);
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

    @Test
    void handleSessionLogic_emitsTitleUpdateForFirstUserText() {
        AssistantChatDto assistantChatDto = new AssistantChatDto();
        assistantChatDto.setSessionId(10L);
        assistantChatDto.setSessionType(SessionType.H_AS.getCode());
        assistantChatDto.setChatContent("请分析这个文件");
        ByaiSession updatedSession = new ByaiSession();
        updatedSession.setSessionId(10L);
        updatedSession.setSessionName("请分析这个文件");
        when(sessionTitleService.resolveInitialTitle(10L, "请分析这个文件")).thenReturn(updatedSession);
        ByteArrayOutputStream outputStream = new ByteArrayOutputStream();

        ReflectionTestUtils.invokeMethod(assistantChatService, "handleSessionLogic", outputStream, assistantChatDto);

        verify(sessionTitleService).resolveInitialTitle(10L, "请分析这个文件");
        String eventPayload = outputStream.toString(StandardCharsets.UTF_8);
        assertThat(eventPayload).contains("\"event\":\"sessionTitleUpdated\"");
        assertThat(eventPayload).contains("\"sessionName\":\"请分析这个文件\"");
    }
}
