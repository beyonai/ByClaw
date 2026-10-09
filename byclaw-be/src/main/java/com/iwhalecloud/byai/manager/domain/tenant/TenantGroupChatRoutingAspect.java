package com.iwhalecloud.byai.manager.domain.tenant;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MessageId;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatMentionMapper;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatReadService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatCreateRequest;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatMemberRequest;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatSettingsRequest;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextRequest;
import java.util.List;
import java.util.Map;
import java.util.HashMap;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatReadStateRequest;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/** Routes HACU group reads to the tenant Node and prevents unported writes from reaching the personal DB. */
@Aspect
@Component
public class TenantGroupChatRoutingAspect {
    @org.springframework.beans.factory.annotation.Autowired
    private TenantGroupMessageAckService messageAckService;
    @org.springframework.beans.factory.annotation.Autowired
    private TenantGroupManagementService management;
    @org.springframework.beans.factory.annotation.Autowired
    private TenantGroupInvitationService invitations;
    @org.springframework.beans.factory.annotation.Autowired
    private TenantGroupCreationService creation;
    private final TenantNodeClient node;
    private final GroupChatReadService legacy;
    private final ByaiGroupChatMentionMapper mentionMapper;
    private final ObjectMapper mapper;
    private final TenantGroupMemberService memberService;

    public TenantGroupChatRoutingAspect(TenantNodeClient node, GroupChatReadService legacy,
        ByaiGroupChatMentionMapper mentionMapper, ObjectMapper mapper, TenantGroupMemberService memberService) {
        this.node = node;
        this.legacy = legacy;
        this.mentionMapper = mentionMapper;
        this.mapper = mapper;
        this.memberService = memberService;
    }

    @Around("execution(* com.iwhalecloud.byai.state.domain.groupchat.interfaces.GroupChatController.*(..))"
        + " || execution(* com.iwhalecloud.byai.state.domain.groupchat.interfaces.GroupChatTopicController.*(..))")
    public Object route(ProceedingJoinPoint call) throws Throwable {
        TenantRequestContext context = TenantRequestContextHolder.get();
        if (context == null) return call.proceed();
        String method = ((MethodSignature) call.getSignature()).getMethod().getName();
        Object[] args = call.getArgs();
        if ("defaultAssistant".equals(method)) return call.proceed();
        if (List.of("createInvitation", "validateInvitation", "joinInvitation").contains(method))
            return ResponseUtil.successResponse(invitations.handle(context, method, args));
        if ("create".equals(method)) return create(context, (GroupChatCreateRequest) args[0]);
        if (args.length == 0 && !"list".equals(method)) throw unsupported();
        String sessionId = args.length > 0 && args[0] instanceof Long id && id > 0 ? id.toString() : null;
        String path = sessionId == null ? null : "/internal/v1/group-chats/" + sessionId;
        // 新增确认接口始终按租户上下文落 Node，不回退到共享消息表。
        if ("acknowledge".equals(method) || "unacknowledge".equals(method)) {
            return ResponseUtil.successResponse(messageAckService.change(context,
                Long.valueOf(id(args[0])), Long.valueOf(id(args[1])), "acknowledge".equals(method)));
        }
        if (List.of("nickname", "changeRole", "transferOwnership", "leave", "dissolve",
            "acknowledgeDissolution", "recall", "directSession").contains(method))
            return ResponseUtil.successResponse(management.change(context, method, Long.valueOf(id(args[0])), args));
        switch (method) {
            case "list": {
                if (args.length == 3 && args[0] instanceof Integer pageNum && args[1] instanceof Integer pageSize) {
                    if (pageNum < 1 || pageSize < 1 || pageSize > 100) throw unsupported();
                    if (args[2] != null && (!(args[2] instanceof Long enterpriseId)
                        || !enterpriseId.equals(context.enterpriseId()))) throw unsupported();
                    return ResponseUtil.successResponse(list(context, pageNum, pageSize));
                }
                if (path != null && args.length == 3) {
                    return read(context, topicPath(path, args[1], args[2]));
                }
                throw unsupported();
            }
            case "detail": return read(context, requirePath(path));
            case "invite": return ResponseUtil.successResponse(memberService.invite(context,
                Long.valueOf(sessionId), (GroupChatMemberRequest) args[1]));
            case "remove": {
                if (path == null || args.length != 3 || !(args[1] instanceof String type)
                    || !(args[2] instanceof Long memberId) || memberId <= 0
                    || !("USER".equals(type) || "AGENT".equals(type))) throw unsupported();
                node.command(context, "DELETE", path + "/members", sessionId,
                    "REMOVE_MEMBER", new TenantNodeModels.RemoveMember(type, memberId.toString()));
                return ResponseUtil.successResponse(null);
            }
            case "settings": return read(context, requirePath(path) + "/settings");
            case "updateSettings": {
                GroupChatSettingsRequest request = (GroupChatSettingsRequest) args[1];
                if (request == null || request.getSessionName() == null
                    && request.getAllowJoinByLink() == null && request.getAllowMemberAddAgent() == null
                    && request.getAllowMemberInviteUser() == null) throw unsupported();
                node.command(context, "PATCH", requirePath(path) + "/settings", sessionId,
                    "UPDATE_SETTINGS", new TenantNodeModels.GroupSettings(request.getSessionName(),
                        request.getAllowJoinByLink(), request.getAllowMemberAddAgent(),
                        request.getAllowMemberInviteUser()));
                Map<String, Object> detail = node.request(context, "GET", path, null,
                    new TypeReference<Map<String, Object>>() { });
                return ResponseUtil.successResponse(detail.get("session"));
            }
            case "lifecycle": return read(context, requirePath(path) + "/lifecycle");
            case "tasks": return read(context, requirePath(path) + "/tasks");
            case "context": {
                GroupChatContextRequest request = (GroupChatContextRequest) args[1];
                if (request == null) throw unsupported();
                Map<String, Object> body = new HashMap<>();
                if (request.getBeforeMessageId() != null) {
                    body.put("beforeMessageId", request.getBeforeMessageId());
                }
                if (request.getMaxMessages() != null) body.put("maxMessages", request.getMaxMessages());
                if (request.getMaxCharacters() != null) body.put("maxCharacters", request.getMaxCharacters());
                return write(context, requirePath(path) + "/context", body);
            }
            case "searchMessages": {
                if (args[1] == null) throw unsupported();
                Map<String, Object> body = mapper.convertValue(args[1],
                    new TypeReference<Map<String, Object>>() { });
                body.values().removeIf(java.util.Objects::isNull);
                return write(context, requirePath(path) + "/messages/search", body);
            }
            case "messageContext": return read(context, requirePath(path) + "/messages/" + id(args[1]) + "/context");
            case "messages": return read(context, topicPath(requirePath(path) + "/topics/" + id(args[1])
                + "/messages", args[2], args[3]));
            case "markRead": {
                GroupChatReadStateRequest request = (GroupChatReadStateRequest) args[1];
                if (request == null || request.getLastReadMessageId() == null || request.getLastReadMessageId() <= 0) {
                    throw unsupported();
                }
                node.command(context, "PATCH", requirePath(path) + "/read-state", sessionId,
                    "READ_STATE", new MessageId(request.getLastReadMessageId().toString()));
                return ResponseUtil.successResponse(java.util.Map.of(
                    "sessionId", sessionId,
                    "lastReadMessageId", request.getLastReadMessageId().toString(),
                    "unreadCount", 0,
                    "unreadMentionCount", 0,
                    "hasUnreadMention", false));
            }
            default: throw unsupported();
        }
    }

    private Object create(TenantRequestContext context, GroupChatCreateRequest request) {
        return ResponseUtil.successResponse(creation.create(context, request));
    }

    private Map<String, Object> list(TenantRequestContext context, int pageNum, int pageSize) {
        return node.request(context, "GET", "/internal/v1/group-chats?pageNum=" + pageNum + "&pageSize=" + pageSize,
            null, new TypeReference<Map<String, Object>>() {});
    }

    private Object read(TenantRequestContext context, String path) {
        return ResponseUtil.successResponse(node.request(context, "GET", path, null,
            new TypeReference<Object>() { }));
    }

    private Object write(TenantRequestContext context, String path, Object body) {
        return ResponseUtil.successResponse(node.request(context, "POST", path, body,
            new TypeReference<Object>() { }));
    }

    private String requirePath(String path) {
        if (path == null) throw unsupported();
        return path;
    }

    private String id(Object value) {
        if (!(value instanceof Long id) || id <= 0) throw unsupported();
        return id.toString();
    }

    private String topicPath(String path, Object limit, Object cursor) {
        StringBuilder result = new StringBuilder(path).append("?limit=");
        int boundedLimit = limit instanceof Integer count && count > 0 && count <= 100 ? count : 20;
        result.append(boundedLimit);
        if (cursor != null) {
            String value = cursor.toString();
            if (!value.matches("[A-Za-z0-9:_-]{1,128}")) throw unsupported();
            result.append("&cursor=").append(value);
        }
        return result.toString();
    }

    private ResponseStatusException unsupported() {
        return new ResponseStatusException(HttpStatus.CONFLICT, "tenant group operation is not ready");
    }
}
