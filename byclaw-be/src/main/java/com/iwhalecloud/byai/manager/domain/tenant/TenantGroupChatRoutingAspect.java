package com.iwhalecloud.byai.manager.domain.tenant;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.GroupCreate;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.EmptyPayload;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.GroupMember;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MessageId;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatMentionMapper;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatReadService;
import com.iwhalecloud.byai.state.domain.groupchat.application.WorkgroupTemplateService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatCreateRequest;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatMemberRequest;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatListItemResponse;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextRequest;
import cn.hutool.core.util.IdUtil;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.HashMap;
import java.util.LinkedHashSet;
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
    private final TenantNodeClient node;
    private final GroupChatReadService legacy;
    private final ByaiGroupChatMentionMapper mentionMapper;
    private final ObjectMapper mapper;
    private final TenantGroupMemberService memberService;
    private final WorkgroupTemplateService templates;

    public TenantGroupChatRoutingAspect(TenantNodeClient node, GroupChatReadService legacy,
        ByaiGroupChatMentionMapper mentionMapper, ObjectMapper mapper, TenantGroupMemberService memberService,
        WorkgroupTemplateService templates) {
        this.node = node;
        this.legacy = legacy;
        this.mentionMapper = mentionMapper;
        this.mapper = mapper;
        this.memberService = memberService;
        this.templates = templates;
    }

    @Around("execution(* com.iwhalecloud.byai.state.domain.groupchat.interfaces.GroupChatController.*(..))"
        + " || execution(* com.iwhalecloud.byai.state.domain.groupchat.interfaces.GroupChatTopicController.*(..))")
    public Object route(ProceedingJoinPoint call) throws Throwable {
        TenantRequestContext context = TenantRequestContextHolder.get();
        if (context == null) return call.proceed();
        String method = ((MethodSignature) call.getSignature()).getMethod().getName();
        Object[] args = call.getArgs();
        if ("defaultAssistant".equals(method)) return ResponseUtil.successResponse(List.of());
        if ("create".equals(method)) return create(context, (GroupChatCreateRequest) args[0]);
        if (args.length == 0 && !"list".equals(method)) throw unsupported();
        String sessionId = args.length > 0 && args[0] instanceof Long id && id > 0 ? id.toString() : null;
        String path = sessionId == null ? null : "/internal/v1/group-chats/" + sessionId;
        if (sessionId != null && mentionMapper.isLegacyGroupMember(Long.valueOf(sessionId),
            context.userId(), context.enterpriseId())) return call.proceed();
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
                var request = (com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatSettingsRequest) args[1];
                if (request == null) throw unsupported();
                node.command(context, "PATCH", requirePath(path) + "/settings", sessionId, "UPDATE_SETTINGS",
                    new TenantNodeModels.GroupSettings(request.getSessionName(), request.getAllowJoinByLink(),
                        request.getAllowMemberAddAgent(), request.getAllowMemberInviteUser()));
                Map<String, Object> detail = node.request(context, "GET", requirePath(path), null,
                    new TypeReference<Map<String, Object>>() { });
                return ResponseUtil.successResponse(detail == null ? null : detail.get("session"));
            }
            case "leave": {
                node.command(context, "POST", requirePath(path) + "/leave", sessionId,
                    "LEAVE_GROUP", new EmptyPayload());
                return ResponseUtil.successResponse(null);
            }
            case "changeRole": {
                if (args.length != 4 || !"USER".equals(args[1]) || !(args[2] instanceof Long userId)
                    || !(args[3] instanceof Map<?, ?> roles) || !(roles.get("role") instanceof String role)
                    || !List.of("ADMIN", "MEMBER").contains(role)) throw unsupported();
                memberService.requireActiveUser(context, userId);
                node.command(context, "PATCH", requirePath(path) + "/members/role", sessionId,
                    "SET_ROLE", new TenantNodeModels.MemberRole(userId.toString(), role),
                    java.util.UUID.randomUUID().toString(), List.of(Long.toString(context.userId()), userId.toString()));
                return ResponseUtil.successResponse(null);
            }
            case "transferOwnership": {
                var request = (com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatTransferOwnershipRequest) args[1];
                if (request == null || request.getUserId() == null) throw unsupported();
                memberService.requireActiveUser(context, request.getUserId());
                node.command(context, "POST", requirePath(path) + "/owner", sessionId, "TRANSFER_OWNER",
                    new TenantNodeModels.GroupUser(request.getUserId().toString()), java.util.UUID.randomUUID().toString(),
                    List.of(Long.toString(context.userId()), request.getUserId().toString()));
                return ResponseUtil.successResponse(null);
            }
            case "lifecycle": return read(context, requirePath(path) + "/lifecycle");
            case "dissolve": {
                node.command(context, "POST", requirePath(path) + "/dissolve", sessionId,
                    "DISSOLVE_GROUP", new EmptyPayload());
                return ResponseUtil.successResponse(null);
            }
            case "acknowledgeDissolution": {
                node.command(context, "POST", requirePath(path) + "/dissolution-ack", sessionId,
                    "ACK_DISSOLUTION", new EmptyPayload());
                return ResponseUtil.successResponse(null);
            }
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
        if (request == null || request.getName() == null || request.getName().isBlank()
            || request.getGoal() == null || request.getGoal().isBlank()
            || request.getTemplateId() == null && request.getExpectedTemplateVersion() != null) throw unsupported();
        LinkedHashSet<Long> agentIds = new LinkedHashSet<>();
        if (request.getAgentIds() != null) agentIds.addAll(request.getAgentIds());
        if (request.getTemplateId() != null) agentIds.addAll(templates.resolveResourceIds(
            request.getTemplateId(), request.getExpectedTemplateVersion()));
        List<GroupMember> members = new ArrayList<>();
        String sessionId = Long.toString(IdUtil.getSnowflakeNextId());
        String name = CurrentUserHolder.getLoginInfo() == null ? ""
            : CurrentUserHolder.getLoginInfo().getUserName();
        members.add(new GroupMember("USER", Long.toString(context.userId()), "OWNER", name));
        if (request.getUserIds() != null && !request.getUserIds().isEmpty()) {
            members.addAll(memberService.initialUsers(context, request.getUserIds()));
        }
        if (!agentIds.isEmpty()) members.addAll(memberService.initialAgents(context, new ArrayList<>(agentIds)));
        GroupCreate payload = new GroupCreate(request.getName(), request.getGoal(), sessionId, members);
        if (members.stream().filter(member -> "USER".equals(member.memObjType())).count() == 1) {
            node.command(context, "POST", "/internal/v1/group-chats", sessionId, "CREATE_GROUP", payload);
        } else {
            node.command(context, "POST", "/internal/v1/group-chats", sessionId, "CREATE_GROUP", payload,
                java.util.UUID.randomUUID().toString(), members.stream().filter(member -> "USER".equals(member.memObjType()))
                    .map(GroupMember::memObjId).toList());
        }
        memberService.grantInitialAgents(new ArrayList<>(agentIds), members);
        return read(context, "/internal/v1/group-chats/" + sessionId);
    }

    private Map<String, Object> list(TenantRequestContext context, int pageNum, int pageSize) {
        long required = (long) pageNum * pageSize;
        if (required > 1000) throw unsupported();
        int count = (int) required;
        PageInfo<GroupChatListItemResponse> old = legacy.listMyGroupsInEnterprise(1, count,
            context.enterpriseId());
        List<Map<String, Object>> joined = new ArrayList<>();
        for (GroupChatListItemResponse item : old.getList()) {
            joined.add(mapper.convertValue(item, new TypeReference<Map<String, Object>>() { }));
        }
        long nodeTotal = 0;
        for (int offset = 0; offset < count; offset += 100) {
            int size = Math.min(100, count);
            int nodePage = offset / 100 + 1;
            Map<String, Object> page = node.request(context, "GET", "/internal/v1/group-chats?pageNum="
                + nodePage + "&pageSize=" + size, null, new TypeReference<Map<String, Object>>() { });
            nodeTotal = ((Number) page.get("total")).longValue();
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> items = (List<Map<String, Object>>) page.get("list");
            joined.addAll(items);
            if (offset + size >= nodeTotal) break;
        }
        joined.sort(Comparator.comparingLong((Map<String, Object> item) ->
            Long.parseLong(item.get("sessionId").toString())).reversed());
        int from = Math.min((pageNum - 1) * pageSize, joined.size());
        int to = Math.min(from + pageSize, joined.size());
        long total = old.getTotal() + nodeTotal;
        return Map.of("list", joined.subList(from, to), "total", total, "pageNum", pageNum,
            "pageSize", pageSize, "totalPages", (int) Math.ceil((double) total / pageSize));
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
