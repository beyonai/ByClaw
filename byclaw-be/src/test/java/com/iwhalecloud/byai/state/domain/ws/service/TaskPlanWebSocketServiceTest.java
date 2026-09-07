package com.iwhalecloud.byai.state.domain.ws.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import com.iwhalecloud.byai.state.application.service.taskplan.TaskPlanApplicationService;
import com.iwhalecloud.byai.state.domain.taskplan.dto.TaskPlanLookupRequest;
import com.iwhalecloud.byai.state.domain.taskplan.dto.TaskPlanSnapshot;
import com.iwhalecloud.byai.state.domain.ws.model.ChatMessage;

import io.netty.channel.Channel;
import io.netty.channel.ChannelHandlerContext;

class TaskPlanWebSocketServiceTest {

    @Test
    void get_queriesTheRequestedAnswerAndRepliesOnlyToTheRequestingChannel() {
        TaskPlanApplicationService plans = mock(TaskPlanApplicationService.class);
        TaskPlanWebSocketPublisher publisher = mock(TaskPlanWebSocketPublisher.class);
        TaskPlanWebSocketService service = new TaskPlanWebSocketService(plans, publisher);
        ChannelHandlerContext ctx = mock(ChannelHandlerContext.class);
        Channel channel = mock(Channel.class);
        when(ctx.channel()).thenReturn(channel);
        TaskPlanSnapshot snapshot = new TaskPlanSnapshot();
        when(plans.findLatestForMessage(any())).thenReturn(snapshot);
        ChatMessage message = new ChatMessage();
        message.setSessionId(11L);
        message.setMessageId(21L);
        message.setClientRequestId("request-1");

        service.get(ctx, message);

        ArgumentCaptor<TaskPlanLookupRequest> request = ArgumentCaptor.forClass(TaskPlanLookupRequest.class);
        verify(plans).findLatestForMessage(request.capture());
        assertThat(request.getValue().getSessionId()).isEqualTo("11");
        assertThat(request.getValue().getMessageId()).isEqualTo("21");
        verify(plans, never()).findActive(any());
        verify(publisher).send(channel, snapshot, "request-1", "11", "21");
    }
}
