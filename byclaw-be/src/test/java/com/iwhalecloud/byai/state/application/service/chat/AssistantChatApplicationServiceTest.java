package com.iwhalecloud.byai.state.application.service.chat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.iwhaleai.byai.framework.client.GatewayClient;
import com.iwhalecloud.byai.common.constants.chat.ConversationObjectType;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.session.SessionUploadResult;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.state.domain.chat.dto.StopChatDto;
import com.iwhalecloud.byai.state.domain.chat.service.RunningChatSnapshotService;
import com.iwhalecloud.byai.state.domain.chat.service.RunningOutputStreamRegistry;
import com.iwhalecloud.byai.state.domain.chat.service.TargetAgentTypeResolver;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.session.service.SessionTitleService;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import java.util.Date;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.multipart.MultipartFile;

class AssistantChatApplicationServiceTest {

    private GatewayClient gatewayClient;
    private SsResourceService ssResourceService;
    private RunningOutputStreamRegistry runningOutputStreamRegistry;
    private RunningChatSnapshotService runningChatSnapshotService;

    private SessionService sessionService;

    private SessionTitleService sessionTitleService;

    private ByaiSystemConfigService byaiSystemConfigService;

    private AssistantChatApplicationService assistantChatApplicationService;

    @BeforeEach
    void setUp() {
        gatewayClient = mock(GatewayClient.class);
        ssResourceService = mock(SsResourceService.class);
        runningOutputStreamRegistry = mock(RunningOutputStreamRegistry.class);
        runningChatSnapshotService = mock(RunningChatSnapshotService.class);
        sessionService = mock(SessionService.class);
        sessionTitleService = mock(SessionTitleService.class);
        byaiSystemConfigService = mock(ByaiSystemConfigService.class);

        assistantChatApplicationService = new AssistantChatApplicationService(gatewayClient);
        ReflectionTestUtils.setField(assistantChatApplicationService, "ssResourceService", ssResourceService);
        ReflectionTestUtils.setField(assistantChatApplicationService, "targetAgentTypeResolver",
            new TargetAgentTypeResolver());
        ReflectionTestUtils.setField(assistantChatApplicationService, "runningOutputStreamRegistry",
            runningOutputStreamRegistry);
        ReflectionTestUtils.setField(assistantChatApplicationService, "runningChatSnapshotService",
            runningChatSnapshotService);
        ReflectionTestUtils.setField(assistantChatApplicationService, "sessionService", sessionService);
        ReflectionTestUtils.setField(assistantChatApplicationService, "sessionTitleService", sessionTitleService);
        ReflectionTestUtils.setField(assistantChatApplicationService, "byaiSystemConfigService", byaiSystemConfigService);

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserCode("u1");
        CurrentUserHolder.setLoginInfo(loginInfo);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void stopChat_clearsRunningStateAfterCancelTask() {
        StopChatDto stopChatDto = new StopChatDto();
        stopChatDto.setAgentId(30L);
        stopChatDto.setSessionId(10L);
        stopChatDto.setMessageId(20L);
        when(ssResourceService.findById(30L)).thenReturn(null);

        assistantChatApplicationService.stopChat(stopChatDto);

        verify(gatewayClient).cancelTask(eq("20"), eq("10"), eq("user cancel task"), eq("BYCLAW_EXE_u1"),
            eq("u1"), eq("force"));
        verify(runningOutputStreamRegistry).release(10L, 20L);
        verify(runningChatSnapshotService).delete(10L, 20L);
    }

    @Test
    void uploadFiles_createsPendingSessionWithTimestampTitle() throws Exception {
        String sessionName = "File Upload 2026-08-11 14:30:25";
        ByaiSession session = new ByaiSession();
        session.setSessionId(10L);
        session.setSessionName(sessionName);
        when(byaiSystemConfigService.getDcSystemConfigValueByCode("DIG_EMPLOYEE_FILE_UPLOAD_CONFIG"))
            .thenReturn("{\"enabled\":false}");
        when(sessionTitleService.buildFileUploadTitle(any(Date.class))).thenReturn(sessionName);
        when(sessionService.createSession(eq(sessionName), eq("h_as"), eq(null),
            eq(ConversationObjectType.SUPER_ASSISTANT), eq(0)))
            .thenReturn(session);

        SessionUploadResult result = assistantChatApplicationService.uploadFiles(new MultipartFile[0], null, "h_as",
            null);

        assertThat(result.getSessionId()).isEqualTo(10L);
        assertThat(result.getSessionName()).isEqualTo(sessionName);
        verify(sessionTitleService).markInitialTitlePending(10L);
    }
}
