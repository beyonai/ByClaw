package com.iwhalecloud.byai.state.domain.ws.service;

import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.state.application.service.taskplan.TaskPlanApplicationService;
import com.iwhalecloud.byai.state.domain.taskplan.dto.TaskPlanLookupRequest;
import com.iwhalecloud.byai.state.domain.taskplan.dto.TaskPlanSnapshot;
import com.iwhalecloud.byai.state.domain.ws.model.ChatMessage;

import io.netty.channel.ChannelHandlerContext;

/** TASK_PLAN_GET 的 WebSocket 查询处理器。 */
@Service
public class TaskPlanWebSocketService {

    private final TaskPlanApplicationService taskPlanService;

    private final TaskPlanWebSocketPublisher publisher;

    public TaskPlanWebSocketService(TaskPlanApplicationService taskPlanService,
        TaskPlanWebSocketPublisher publisher) {
        this.taskPlanService = taskPlanService;
        this.publisher = publisher;
    }

    public void get(ChannelHandlerContext ctx, ChatMessage message) {
        TaskPlanLookupRequest request = new TaskPlanLookupRequest();
        request.setSessionId(message.getSessionId() == null ? null : String.valueOf(message.getSessionId()));
        request.setMessageId(message.getMessageId() == null ? null : String.valueOf(message.getMessageId()));
        request.setTraceId(message.getTraceId());
        request.setIncludeTerminal(true);
        TaskPlanSnapshot snapshot = taskPlanService.findActive(request);
        publisher.send(ctx.channel(), snapshot, message.getClientRequestId(), request.getSessionId(),
            request.getMessageId());
    }
}
