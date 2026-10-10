package com.iwhalecloud.byai.manager.domain.tenant;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.core.type.TypeReference;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MessageIds;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MessageView;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.SessionView;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.application.service.chat.AssistantChatApplicationService;
import com.iwhalecloud.byai.state.common.dto.MessageStructDto;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatInfo;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatSnapshotRequest;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatStatusRequest;
import com.iwhalecloud.byai.state.domain.chat.dto.StopChatDto;
import com.iwhalecloud.byai.state.domain.chat.service.RunningChatSnapshotService;
import com.iwhalecloud.byai.state.domain.chat.service.RunningOutputStreamRegistry;
import com.iwhalecloud.byai.state.domain.ws.model.ChatMessage;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/** Authorizes tenant runtime operations in the Node before touching shared runtime state. */
@Aspect
@Component
public class TenantChatRuntimeRoutingAspect {
    private final TenantNodeClient node;
    private final RunningOutputStreamRegistry running;
    private final RunningChatSnapshotService snapshots;
    private final AssistantChatApplicationService chat;

    public TenantChatRuntimeRoutingAspect(TenantNodeClient node, RunningOutputStreamRegistry running,
        RunningChatSnapshotService snapshots, AssistantChatApplicationService chat) {
        this.node = node;
        this.running = running;
        this.snapshots = snapshots;
        this.chat = chat;
    }

    @Around("execution(* com.iwhalecloud.byai.state.interfaces.controller.chat.AssistantChatController.*(..))")
    public Object route(ProceedingJoinPoint call) throws Throwable {
        TenantRequestContext context = TenantRequestContextHolder.get();
        if (context == null) return call.proceed();
        String method = ((MethodSignature) call.getSignature()).getMethod().getName();
        Object[] args = call.getArgs();
        switch (method) {
            case "runningStatus": {
                RunningChatStatusRequest request = (RunningChatStatusRequest) args[0];
                List<RunningChatInfo> result = new ArrayList<>();
                if (request == null || request.getSessionIds() == null) return ResponseUtil.successResponse(result);
                if (request.getSessionIds().size() > 100) throw invalid();
                for (Long id : request.getSessionIds().stream().distinct().toList()) {
                    try {
                        session(context, id);
                        result.add(running.getRunning(id));
                    } catch (ResponseStatusException error) {
                        if (error.getStatusCode().value() != 403 && error.getStatusCode().value() != 404) throw error;
                    }
                }
                return ResponseUtil.successResponse(result);
            }
            case "runningSnapshot": {
                RunningChatSnapshotRequest request = (RunningChatSnapshotRequest) args[0];
                if (request == null || request.getSessionId() == null) return ResponseUtil.successResponse(null);
                session(context, request.getSessionId());
                return ResponseUtil.successResponse(snapshots.get(request.getSessionId(), request.getTraceId(),
                    request.getModelAnswerMessageId()));
            }
            case "stopChat": {
                StopChatDto request = (StopChatDto) args[1];
                if (request == null) throw invalid();
                authorizeStop(context, request.getSessionId(), request.getMessageId());
                return call.proceed();
            }
            case "getSessionStatus":
                session(context, id(args[0]));
                return call.proceed();
            case "getMessageById":
                return ResponseUtil.successResponse(TenantChatHistoryProjection.project(message(context, id(args[0]))));
            case "getTraceIdByMessageId": {
                Map<String, String> trace = node.request(context, "GET",
                    "/internal/v1/messages/" + id(args[0]) + "/trace", null,
                    new TypeReference<Map<String, String>>() { });
                return ResponseUtil.successResponse(trace.get("traceId"));
            }
            case "updateMessageStructById": {
                MessageStructDto request = (MessageStructDto) args[0];
                if (request == null) throw invalid();
                if (!List.of("messageStruct", "inferLog").contains(request.getUpdateField())
                    || request.getId() == null || request.getContent() == null) throw invalid();
                MessageView message;
                try {
                    message = message(context, request.getMessageId());
                } catch (ResponseStatusException error) {
                    if (error.getStatusCode().value() != 404 || request.getSessionId() == null) throw error;
                    session(context, request.getSessionId());
                    var updated = chat.updateRunningSnapshotMessageStructInSession(request);
                    if (updated == null) throw error;
                    return ResponseUtil.successResponse(updated);
                }
                if (request.getSessionId() != null && !request.getSessionId().toString().equals(message.sessionId())) {
                    throw invalid();
                }
                String sessionId = message.sessionId();
                request.setSessionId(Long.valueOf(sessionId));
                node.command(context, "PATCH", "/internal/v1/sessions/" + sessionId + "/messages/"
                    + request.getMessageId() + "/structure", sessionId, "UPDATE_MESSAGE_STRUCTURE",
                    new TenantNodeModels.MessageStructure(request.getMessageId().toString(), request.getUpdateField(),
                        request.getId(), request.getContent()));
                chat.syncRunningStateAfterUpdate(request);
                return ResponseUtil.successResponse(message(context, request.getMessageId()));
            }
            default:
                throw new ResponseStatusException(HttpStatus.CONFLICT, "tenant chat operation is not ready");
        }
    }

    /** WebSocket STOP_CHAT must use the same tenant authorization as the HTTP endpoint. */
    @Around("execution(* com.iwhalecloud.byai.state.domain.ws.service.ChatService.stopChat(..))")
    public Object stopWebSocket(ProceedingJoinPoint call) throws Throwable {
        TenantRequestContext context = TenantRequestContextHolder.get();
        if (context != null) {
            ChatMessage request = (ChatMessage) call.getArgs()[1];
            if (request == null) throw invalid();
            authorizeStop(context, request.getSessionId(), request.getMessageId());
        }
        return call.proceed();
    }

    private void authorizeStop(TenantRequestContext context, Long sessionId, Long messageId) {
        session(context, sessionId);
        if (messageId == null) return;
        RunningChatInfo active = running.getRunning(sessionId);
        if (active == null || !messageId.equals(active.getModelAnswerMessageId())) {
            MessageView message = message(context, messageId);
            if (!sessionId.toString().equals(message.sessionId())) throw invalid();
        }
    }

    private void session(TenantRequestContext context, Long sessionId) {
        if (sessionId == null || sessionId <= 0) throw invalid();
        node.request(context, "GET", "/internal/v1/sessions/" + sessionId, null,
            new TypeReference<SessionView>() { });
    }

    private MessageView message(TenantRequestContext context, Long messageId) {
        if (messageId == null || messageId <= 0) throw invalid();
        List<MessageView> messages = node.request(context, "POST", "/internal/v1/assiman/getMessageByIds",
            new MessageIds(List.of(messageId)), new TypeReference<List<MessageView>>() { });
        if (messages == null || messages.size() != 1 || !messageId.toString().equals(messages.get(0).messageId())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "tenant message not found");
        }
        return messages.get(0);
    }

    private Long id(Object value) {
        try {
            Long id = value instanceof Long number ? number : Long.valueOf(String.valueOf(value));
            if (id <= 0) throw invalid();
            return id;
        } catch (NumberFormatException error) {
            throw invalid();
        }
    }

    private ResponseStatusException invalid() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid tenant chat request");
    }
}
