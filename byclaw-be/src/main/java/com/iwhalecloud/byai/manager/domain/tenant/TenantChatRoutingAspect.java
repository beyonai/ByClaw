package com.iwhalecloud.byai.manager.domain.tenant;

import java.util.List;

import com.fasterxml.jackson.core.type.TypeReference;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.EmptyPayload;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MessageIds;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MessageId;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MessageOutline;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MessageQuery;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MessageView;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.Page;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.SessionQuery;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.SessionRef;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.SessionUpdate;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.SessionView;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatMentionMapper;
import com.iwhalecloud.byai.manager.qo.devloop.ProjectSessionQo;
import com.iwhalecloud.byai.manager.qo.session.ByaiSessionQo;
import com.iwhalecloud.byai.manager.qo.session.SessionByAgentQo;
import com.iwhalecloud.byai.state.domain.message.model.MessageFeedbackDto;
import com.iwhalecloud.byai.state.domain.message.enums.PraiseAndTreadEnum;
import com.iwhalecloud.byai.state.domain.message.enums.FeedbackTypeEnum;
import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.state.common.dto.MessageQo;
import com.iwhalecloud.byai.state.domain.message.model.SessionOpeartorDto;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.server.ResponseStatusException;

/** Keeps the public chat API stable while dispatching tenant requests to the owning Node. */
@Aspect
@Component
public class TenantChatRoutingAspect {

    private final TenantNodeClient node;
    private final ByaiGroupChatMentionMapper mentionMapper;

    @Autowired
    public TenantChatRoutingAspect(TenantNodeClient node, ByaiGroupChatMentionMapper mentionMapper) {
        this.node = node;
        this.mentionMapper = mentionMapper;
    }

    public TenantChatRoutingAspect(TenantNodeClient node) {
        this.node = node;
        this.mentionMapper = null;
    }

    @Around("execution(* com.iwhalecloud.byai.state.interfaces.controller.manage.AssistantManController.*(..))"
        + " || execution(* com.iwhalecloud.byai.manager.interfaces.controller.devloop.ProjectController.listSessionsByProject(..))")
    public Object route(ProceedingJoinPoint call) throws Throwable {
        TenantRequestContext context = TenantRequestContextHolder.get();
        if (context == null) return call.proceed();
        String method = ((MethodSignature) call.getSignature()).getMethod().getName();
        Object[] args = call.getArgs();
        if (mentionMapper != null && args.length > 0 && args[0] instanceof ByaiSessionQo sessionQuery
            && isLegacyGroup(context, sessionQuery.getSessionId())) return call.proceed();
        if (mentionMapper != null && args.length > 0 && args[0] instanceof MessageQo messageQuery
            && isLegacyGroup(context, messageQuery.getSessionId())) return call.proceed();
        switch (method) {
            case "querySessionByAgent": {
                SessionByAgentQo query = (SessionByAgentQo) args[0];
                if (query.getObjectId() == null || query.getObjectId() <= 0) throw badRequest();
                SessionQuery body = new SessionQuery(query.getPageNum() == null ? 1 : query.getPageNum(),
                    query.getPageSize() == null ? 10 : query.getPageSize(),
                    query.getKeyword() == null ? "" : query.getKeyword(), List.of("h_as", "h_h", "hs_as"),
                    null, query.getObjectId().toString());
                Page<SessionView> page = node.request(context, "POST", "/internal/v1/sessions/query", body,
                    new TypeReference<Page<SessionView>>() { });
                return ResponseUtil.successResponse(new Page<>(page.list(), page.total(), page.pageNum(),
                    page.pageSize(), page.pageSize() <= 0 ? 0 : (int) Math.ceil((double) page.total() / page.pageSize())));
            }
            case "updateMessage": {
                SessionOpeartorDto request = (SessionOpeartorDto) args[0];
                return feedback(context, request.getMessageId(), request.getType(), "reaction",
                    request.getFeedback() == null ? null : JSON.toJSONString(request.getFeedback()));
            }
            case "updateMesFeedback": {
                MessageFeedbackDto request = (MessageFeedbackDto) args[0];
                if (request.getMessageId() == null
                    || PraiseAndTreadEnum.getName(request.getType()) == PraiseAndTreadEnum.TREAD
                        && FeedbackTypeEnum.getName(request.getFeedbackLabel()) == null) throw badRequest();
                return feedback(context, request.getMessageId().toString(), request.getType(), "feedback",
                    JSON.toJSONString(request));
            }
            case "qryConversations": {
                ByaiSessionQo query = (ByaiSessionQo) args[0];
                if (query.getSessionId() != null) {
                    if (query.getSessionId() <= 0 || query.getParentSessionId() != null
                        || query.getObjectId() != null || query.getObjectType() != null) {
                        throw unsupported();
                    }
                    SessionView session = node.request(context, "GET",
                        "/internal/v1/sessions/" + query.getSessionId(), null,
                        new TypeReference<SessionView>() { });
                    return ResponseUtil.successResponse(new Page<>(List.of(session), 1, 1, 1, 1));
                }
                if (query.getParentSessionId() != null || query.getObjectId() != null
                    || query.getObjectType() != null) {
                    throw unsupported();
                }
                List<String> types = query.getSessionType() == null || query.getSessionType().isEmpty()
                    ? List.of("h_as") : query.getSessionType();
                if (types.stream().anyMatch(type -> !List.of("h_as", "h_h", "hs_as").contains(type))) {
                    throw unsupported();
                }
                SessionQuery body = new SessionQuery(query.getPageNum(), query.getPageSize(),
                    query.getSearchKeyword() == null ? "" : query.getSearchKeyword(), types, null);
                Page<SessionView> page = node.request(context, "POST", "/internal/v1/sessions/query",
                    body, new TypeReference<Page<SessionView>>() { });
                int totalPages = page.pageSize() <= 0 ? 0
                    : (int) Math.ceil((double) page.total() / page.pageSize());
                return ResponseUtil.successResponse(new Page<>(page.list(), page.total(), page.pageNum(),
                    page.pageSize(), totalPages));
            }
            case "listSessionsByProject": {
                ProjectSessionQo query = (ProjectSessionQo) args[0];
                if (query.getProjectId() == null || query.getProjectId() == 0 || query.getProjectId() < -1
                    || query.getCreateBy() != null || query.getSearchMode() != null) {
                    throw unsupported();
                }
                int pageNum = query.getPageNum() == null ? 1 : query.getPageNum();
                int pageSize = query.getPageSize() == null ? 10 : query.getPageSize();
                SessionQuery body = new SessionQuery(pageNum, pageSize,
                    query.getKeyword() == null ? "" : query.getKeyword(),
                    List.of("h_as", "h_h", "hs_as"), query.getProjectId().toString());
                Page<SessionView> page = node.request(context, "POST", "/internal/v1/sessions/query",
                    body, new TypeReference<Page<SessionView>>() { });
                int totalPages = page.pageSize() <= 0 ? 0
                    : (int) Math.ceil((double) page.total() / page.pageSize());
                return ResponseUtil.successResponse(new Page<>(page.list(), page.total(), page.pageNum(),
                    page.pageSize(), totalPages));
            }
            case "getMessages": {
                MessageQo query = (MessageQo) args[0];
                if (query.getSessionId() == null || query.getSessionId() <= 0) throw unsupported();
                query.initPage();
                MessageQuery body = new MessageQuery(query.getSessionId().toString(),
                    query.getPageNum(), query.getPageSize());
                Page<MessageView> page = node.request(context, "POST",
                    "/internal/v1/assiman/getMessages", body, new TypeReference<Page<MessageView>>() { });
                TenantChatHistoryProjection.project(page.list());
                return ResponseUtil.successResponse(page);
            }
            case "getMessageOutline": {
                MessageQo query = (MessageQo) args[0];
                if (query.getSessionId() == null || query.getSessionId() <= 0) throw unsupported();
                return ResponseUtil.successResponse(node.request(context, "POST",
                    "/internal/v1/assiman/getMessageOutline", new SessionRef(query.getSessionId().toString()),
                    new TypeReference<List<MessageOutline>>() { }));
            }
            case "getForwardMessages": {
                if (args[0] instanceof Long messageId) {
                    if (messageId <= 0) throw unsupported();
                    return ResponseUtil.successResponse(TenantChatHistoryProjection.project(node.request(context, "GET",
                        "/internal/v1/assiman/getForwardMessage/" + messageId, null,
                        new TypeReference<List<MessageView>>() { })));
                }
                if (!(args[0] instanceof MessageQo)) throw unsupported();
                MessageQo query = (MessageQo) args[0];
                if (query.getMessageIds() == null || query.getMessageIds().isEmpty()) throw unsupported();
                return ResponseUtil.successResponse(TenantChatHistoryProjection.project(node.request(context, "POST",
                    "/internal/v1/assiman/getMessageByIds", new MessageIds(query.getMessageIds()),
                    new TypeReference<List<MessageView>>() { })));
            }
            case "updateConversation": {
                SessionOpeartorDto request = (SessionOpeartorDto) args[0];
                if (request.getSessionId() == null || request.getSessionId() <= 0) throw unsupported();
                if (request.getSessionName() == null && request.getSessionContent() == null) throw unsupported();
                SessionUpdate payload = new SessionUpdate(request.getSessionName(), request.getSessionContent());
                String sessionId = request.getSessionId().toString();
                return ResponseUtil.successResponse(node.command(context, "PATCH",
                    "/internal/v1/sessions/" + sessionId, sessionId, "UPDATE_SESSION", payload));
            }
            case "removeConversation": {
                Long sessionId = (Long) args[0];
                if (sessionId == null || sessionId <= 0) throw unsupported();
                node.command(context, "DELETE", "/internal/v1/sessions/" + sessionId,
                    sessionId.toString(), "DELETE_SESSION", new EmptyPayload());
                return ResponseUtil.success("OK");
            }
            case "deleteMessage": {
                SessionOpeartorDto request = (SessionOpeartorDto) args[0];
                String messageId = request.getMessageId();
                if (messageId == null || !messageId.matches("[1-9][0-9]*")) throw unsupported();
                List<MessageView> messages = node.request(context, "POST",
                    "/internal/v1/assiman/getMessageByIds", new MessageIds(List.of(Long.valueOf(messageId))),
                    new TypeReference<List<MessageView>>() { });
                if (messages == null || messages.size() != 1 || !messageId.equals(messages.get(0).messageId())) {
                    throw new ResponseStatusException(HttpStatus.NOT_FOUND, "tenant message not found");
                }
                String sessionId = messages.get(0).sessionId();
                if (sessionId == null || !sessionId.matches("[1-9][0-9]*")) throw unsupported();
                node.command(context, "POST", "/internal/v1/sessions/" + sessionId
                    + "/messages/" + messageId + "/recall", sessionId, "RECALL_MESSAGE",
                    new MessageId(messageId));
                return ResponseUtil.success("delete success");
            }
            default:
                throw unsupported();
        }
    }

    private boolean isLegacyGroup(TenantRequestContext context, Long sessionId) {
        return sessionId != null && sessionId > 0 && mentionMapper.isLegacyGroupMember(sessionId,
            context.userId(), context.enterpriseId());
    }

    private Object feedback(TenantRequestContext context, String messageId, String type, String mode, String details) {
        if (messageId == null || !messageId.matches("[1-9][0-9]*") || PraiseAndTreadEnum.getName(type) == null) {
            throw badRequest();
        }
        List<MessageView> messages = node.request(context, "POST", "/internal/v1/assiman/getMessageByIds",
            new MessageIds(List.of(Long.valueOf(messageId))), new TypeReference<List<MessageView>>() { });
        if (messages == null || messages.size() != 1 || !messageId.equals(messages.get(0).messageId())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "tenant message not found");
        }
        String sessionId = messages.get(0).sessionId();
        var result = node.command(context, "POST",
            "/internal/v1/sessions/" + sessionId + "/messages/" + messageId + "/feedback", sessionId,
            "UPDATE_FEEDBACK", new TenantNodeModels.MessageFeedback(messageId, type.toLowerCase(java.util.Locale.ROOT), mode, details));
        return ResponseUtil.successResponse("update message success", result.metadata());
    }

    private ResponseStatusException badRequest() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid tenant chat request");
    }

    private ResponseStatusException unsupported() {
        return new ResponseStatusException(HttpStatus.CONFLICT, "tenant chat operation is not ready");
    }
}
