package com.iwhalecloud.byai.state.application.service.message;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.common.message.service.ByaiMessageHotService;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.state.application.service.taskplan.TaskPlanApplicationService;
import com.iwhalecloud.byai.state.common.dto.MessageQo;
import com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto;
import com.iwhalecloud.byai.state.domain.showcase.service.ShowcaseService;
import com.iwhalecloud.byai.state.domain.taskplan.dto.TaskPlanSnapshot;

class MessageServiceTest {

    private ByaiMessageHotService byaiMessageHotService;

    private ShowcaseService showcaseService;

    private TaskPlanApplicationService taskPlanApplicationService;

    private MessageService service;

    @BeforeEach
    void setUp() {
        byaiMessageHotService = mock(ByaiMessageHotService.class);
        showcaseService = mock(ShowcaseService.class);
        taskPlanApplicationService = mock(TaskPlanApplicationService.class);
        service = new MessageService();
        ReflectionTestUtils.setField(service, "byaiMessageHotService", byaiMessageHotService);
        ReflectionTestUtils.setField(service, "showcaseService", showcaseService);
        ReflectionTestUtils.setField(service, "taskPlanApplicationService", taskPlanApplicationService);
        when(showcaseService.getByaiShowcaseList(any())).thenReturn(List.of());
    }

    @Test
    void getMessages_enrichesMatchingAnswerWithTerminalTaskPlan() {
        ByaiMessage userMessage = message(11L, 1);
        ByaiMessage answerMessage = message(12L, 2);
        PageInfo<ByaiMessage> storedPage = new PageInfo<>();
        storedPage.setPageNum(1);
        storedPage.setPageSize(20);
        storedPage.setTotal(2);
        storedPage.setList(List.of(userMessage, answerMessage));
        when(byaiMessageHotService.selectByPageQo(any())).thenReturn(storedPage);

        TaskPlanSnapshot taskPlan = new TaskPlanSnapshot();
        taskPlan.setPlanId("99");
        taskPlan.setMessageId("12");
        taskPlan.setStatus("COMPLETED");
        taskPlan.setVersion(3);
        when(taskPlanApplicationService.findLatestByMessageIds(11L, List.of(11L, 12L)))
            .thenReturn(Map.of(12L, taskPlan));

        MessageQo query = new MessageQo();
        query.setSessionId(11L);
        query.setPageNum(1L);
        query.setPageSize(20L);
        PageInfo<ByaiMessageHotDtoDto> result = service.getMessages(query);

        assertThat(result.getList()).hasSize(2);
        assertThat(result.getList().get(0).getTaskPlan()).isNull();
        assertThat(result.getList().get(1).getTaskPlan()).isSameAs(taskPlan);
        verify(taskPlanApplicationService).findLatestByMessageIds(11L, List.of(11L, 12L));
    }

    @Test
    void deleteMessage_removesTaskPlanBeforeMessage() {
        service.deleteMessage("12");

        verify(taskPlanApplicationService).deleteByMessageId(12L);
        verify(byaiMessageHotService).deleteById(12L);
    }

    private ByaiMessage message(Long messageId, Integer usage) {
        ByaiMessage message = new ByaiMessage();
        message.setMessageId(messageId);
        message.setSessionId(11L);
        message.setUsage(usage);
        message.setMessageContent("message-" + messageId);
        return message;
    }
}
