package com.iwhalecloud.byai.manager.domain.tenant.aspect;

import com.iwhalecloud.byai.manager.domain.tenant.*;

import com.iwhalecloud.byai.common.i18n.I18nUtil;

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
import org.springframework.web.server.ResponseStatusException;

/**
 * 普通聊天接口的租户路由器：根据 Controller 方法名把标准租户请求转到所属 Node，
 * 同时保留个人空间和试用租户的公共库处理链路，并在转发前校验参数和资源归属。
 */
@Aspect
@Component
public class TenantChatRoutingAspect {
    private final TenantModeService tenantModes;

    private final TenantNodeClient node;
    private final ByaiGroupChatMentionMapper mentionMapper;

    public TenantChatRoutingAspect(TenantNodeClient node, ByaiGroupChatMentionMapper mentionMapper,
                                   TenantModeService tenantModes) {
        this.node = node;
        this.mentionMapper = mentionMapper;
        this.tenantModes = tenantModes;
    }

    @Around("execution(* com.iwhalecloud.byai.state.interfaces.controller.manage.AssistantManController.*(..))"
        + " || execution(* com.iwhalecloud.byai.manager.interfaces.controller.devloop.ProjectController.listSessionsByProject(..))"
        + " || execution(* com.iwhalecloud.byai.state.interfaces.controller.showcase.ShowcaseController.getMessageCountAndPosition(..))")
    /**
     * 统一路由普通聊天接口：试用租户继续使用公共库，标准租户转发到所属 Node。
     * 方法名由切点匹配的 Controller 方法决定，具体分支按方法名校验请求并调用 Node。
     */
    public Object route(ProceedingJoinPoint call) throws Throwable {
        TenantRequestContext context = TenantRequestContextHolder.get();
        // 没有租户上下文时保持个人空间旧逻辑；试用租户没有独立 Node，也走公共库。
        if (context == null || tenantModes.isSharedDataTenant(context.enterpriseId())) return call.proceed();
        String method = ((MethodSignature) call.getSignature()).getMethod().getName();
        Object[] args = call.getArgs();
        if (mentionMapper != null && args.length > 0 && args[0] instanceof ByaiSessionQo sessionQuery
            && isLegacyGroup(context, sessionQuery.getSessionId())) return call.proceed();
        if (mentionMapper != null && args.length > 0 && args[0] instanceof MessageQo messageQuery
            && isLegacyGroup(context, messageQuery.getSessionId())) return call.proceed();
        switch (method) {
            case "querySessionByAgent": {
                // 按智能体查询会话：先校验智能体 ID，再调用 Node 的会话查询接口。
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
                // 更新消息反馈或操作信息，最终统一交给 feedback 方法写入 Node。
                SessionOpeartorDto request = (SessionOpeartorDto) args[0];
                return feedback(context, request.getMessageId(), request.getType(), "reaction",
                    request.getFeedback() == null ? null : JSON.toJSONString(request.getFeedback()));
            }
            case "updateMesFeedback": {
                // 保存消息点赞/点踩反馈，只接受合法消息 ID 和反馈类型。
                MessageFeedbackDto request = (MessageFeedbackDto) args[0];
                if (request.getMessageId() == null
                    || PraiseAndTreadEnum.getName(request.getType()) == PraiseAndTreadEnum.TREAD
                        && FeedbackTypeEnum.getName(request.getFeedbackLabel()) == null) throw badRequest();
                return feedback(context, request.getMessageId().toString(), request.getType(), "feedback",
                    JSON.toJSONString(request));
            }
            case "qryConversations": {
                // 查询会话列表；内部 if 分别校验会话、父会话、分页和类型筛选条件。
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
                if (query.getParentSessionId() != null) {
                    if (query.getParentSessionId() <= 0 || query.getObjectId() != null || query.getObjectType() != null)
                        throw unsupported();
                    int pageNum = query.getPageNum() == null ? 1 : query.getPageNum();
                    int pageSize = query.getPageSize() == null ? 100 : query.getPageSize();
                    if (pageNum < 1 || pageNum > 100000 || pageSize < 1 || pageSize > 100) throw badRequest();
                    Page<java.util.Map<String, Object>> children = node.request(context, "POST",
                        "/internal/v1/sessions/" + query.getParentSessionId() + "/children/query",
                        new SessionQuery(pageNum, pageSize,
                            query.getSearchKeyword() == null ? "" : query.getSearchKeyword(), List.of("h_as"), null),
                        new TypeReference<Page<java.util.Map<String, Object>>>() { });
                    return ResponseUtil.successResponse(children);
                }
                if (query.getObjectId() != null
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
                // 按项目查询会话，项目 ID 的特殊值遵循原接口契约。
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
                // 查询会话消息列表，sessionId 是 Node 路径中的会话主键。
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
            case "getMessageCountAndPosition": {
                // 查询消息在会话中的数量和位置，用于前端定位消息。
                MessageQo query = (MessageQo) args[0];
                if (query.getSessionId() == null || query.getSessionId() <= 0 || query.getMessageId() == null
                    || query.getMessageId() <= 0) throw badRequest();
                List<MessageOutline> outline = node.request(context, "POST",
                    "/internal/v1/assiman/getMessageOutline", new SessionRef(query.getSessionId().toString()),
                    new TypeReference<List<MessageOutline>>() { });
                MessageOutline target = outline.stream()
                    .filter(message -> query.getMessageId().toString().equals(message.messageId()))
                    .findFirst().orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
                return ResponseUtil.successResponse(java.util.Map.of("position", target.position(),
                    "totalCount", target.totalCount()));
            }
            case "getMessageOutline": {
                // 查询会话消息大纲，减少打开长会话时的传输量。
                MessageQo query = (MessageQo) args[0];
                if (query.getSessionId() == null || query.getSessionId() <= 0) throw unsupported();
                return ResponseUtil.successResponse(node.request(context, "POST",
                    "/internal/v1/assiman/getMessageOutline", new SessionRef(query.getSessionId().toString()),
                    new TypeReference<List<MessageOutline>>() { }));
            }
            case "getForwardMessages": {
                // 查询转发消息：单个消息 ID 和批量消息 ID 对应两种参数形态。
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
                // 更新会话名称或摘要，至少提供一个可更新字段。
                SessionOpeartorDto request = (SessionOpeartorDto) args[0];
                if (request.getSessionId() == null || request.getSessionId() <= 0) throw unsupported();
                if (request.getSessionName() == null && request.getSessionContent() == null) throw unsupported();
                SessionUpdate payload = new SessionUpdate(request.getSessionName(), request.getSessionContent());
                String sessionId = request.getSessionId().toString();
                return ResponseUtil.successResponse(node.command(context, "PATCH",
                    "/internal/v1/sessions/" + sessionId, sessionId, "UPDATE_SESSION", payload));
            }
            case "removeConversation": {
                // 删除会话前校验会话 ID，再由 Node 删除租户库记录。
                Long sessionId = (Long) args[0];
                if (sessionId == null || sessionId <= 0) throw unsupported();
                node.command(context, "DELETE", "/internal/v1/sessions/" + sessionId,
                    sessionId.toString(), "DELETE_SESSION", new EmptyPayload());
                return ResponseUtil.success("OK");
            }
            case "deleteMessage": {
                // 删除消息前确认消息属于指定会话，防止跨会话误删。
                SessionOpeartorDto request = (SessionOpeartorDto) args[0];
                String messageId = request.getMessageId();
                if (messageId == null || !messageId.matches("[1-9][0-9]*")) throw unsupported();
                List<MessageView> messages = node.request(context, "POST",
                    "/internal/v1/assiman/getMessageByIds", new MessageIds(List.of(Long.valueOf(messageId))),
                    new TypeReference<List<MessageView>>() { });
                if (messages == null || messages.size() != 1 || !messageId.equals(messages.get(0).messageId())) {
                    throw new ResponseStatusException(HttpStatus.NOT_FOUND, "tenant.message.notFound");
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

    /** 判断指定会话是否仍属于公共库中的历史群组。 */
    private boolean isLegacyGroup(TenantRequestContext context, Long sessionId) {
        return sessionId != null && sessionId > 0 && mentionMapper.isLegacyGroupMember(sessionId,
            context.userId(), context.enterpriseId());
    }

    /** 校验反馈消息归属后，把反馈操作转发给租户 Node。 */
    private Object feedback(TenantRequestContext context, String messageId, String type, String mode, String details) {
        if (messageId == null || !messageId.matches("[1-9][0-9]*") || PraiseAndTreadEnum.getName(type) == null) {
            throw badRequest();
        }
        List<MessageView> messages = node.request(context, "POST", "/internal/v1/assiman/getMessageByIds",
            new MessageIds(List.of(Long.valueOf(messageId))), new TypeReference<List<MessageView>>() { });
        if (messages == null || messages.size() != 1 || !messageId.equals(messages.get(0).messageId())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "tenant.message.notFound");
        }
        String sessionId = messages.get(0).sessionId();
        var result = node.command(context, "POST",
            "/internal/v1/sessions/" + sessionId + "/messages/" + messageId + "/feedback", sessionId,
            "UPDATE_FEEDBACK", new TenantNodeModels.MessageFeedback(messageId, type.toLowerCase(java.util.Locale.ROOT), mode, details));
        return ResponseUtil.successResponse(I18nUtil.get("chat.message.updated"), result.metadata());
    }

    /** 构造统一的请求参数错误。 */
    private ResponseStatusException badRequest() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "tenant.chat.request.invalid");
    }

    /** 构造统一的“当前租户暂不支持”错误。 */
    private ResponseStatusException unsupported() {
        return new ResponseStatusException(HttpStatus.CONFLICT, "tenant.chat.notReady");
    }
}
