package com.iwhalecloud.byai.state.application.service.session;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.message.service.ByaiMessageHotService;
import com.iwhalecloud.byai.state.application.service.taskplan.TaskPlanApplicationService;
import com.iwhalecloud.byai.state.domain.session.service.SessionExtService;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;

class SessionApplicationServiceTest {

    @Test
    void removeConversation_removesTaskPlanBeforeConversationData() {
        SessionApplicationService service = new SessionApplicationService();
        TaskPlanApplicationService taskPlanService = mock(TaskPlanApplicationService.class);
        SessionService sessionService = mock(SessionService.class);
        SessionExtService sessionExtService = mock(SessionExtService.class);
        SessionMemberService sessionMemberService = mock(SessionMemberService.class);
        ByaiMessageHotService messageService = mock(ByaiMessageHotService.class);
        ReflectionTestUtils.setField(service, "taskPlanApplicationService", taskPlanService);
        ReflectionTestUtils.setField(service, "sessionService", sessionService);
        ReflectionTestUtils.setField(service, "sessionExtService", sessionExtService);
        ReflectionTestUtils.setField(service, "sessionMemberService", sessionMemberService);
        ReflectionTestUtils.setField(service, "byaiMessageHotService", messageService);

        service.removeConversation(11L);

        verify(taskPlanService).deleteBySessionId(11L);
        verify(sessionService).delete(11L);
        verify(sessionExtService).deleteSessionExtBySessionId(11L);
        verify(sessionMemberService).deleteBySessionId(11L);
        verify(messageService).deleteByQo(any());
    }
}
