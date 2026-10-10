package com.iwhalecloud.byai.manager.domain.tenant;

import com.alibaba.fastjson.JSONObject;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantMembershipMapper;
import com.iwhalecloud.byai.state.domain.groupchat.dto.DirectSessionCreateRequest;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatNicknameRequest;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatTransferOwnershipRequest;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/** 群管理适配：持久化交给 Node，BE 保留停任务和成员事件推送。 */
@Service
public class TenantGroupManagementService {
    private final TenantGroupData data;
    private final ObjectMapper mapper;
    private final GroupChatEventPublisher events;
    private final TenantGroupTaskStopService tasks;
    private final TenantMembershipMapper memberships;

    public TenantGroupManagementService(TenantGroupData data, ObjectMapper mapper,
        GroupChatEventPublisher events, TenantGroupTaskStopService tasks, TenantMembershipMapper memberships) {
        this.data = data;
        this.mapper = mapper;
        this.events = events;
        this.tasks = tasks;
        this.memberships = memberships;
    }

    public Object change(TenantRequestContext tenant, String method, Long groupId, Object[] args) {
        String id = groupId.toString();
        if ("acknowledgeDissolution".equals(method)) {
            data.write(tenant, "POST", "/dissolution-ack", id, "ACK_DISSOLUTION", Map.of());
            return null;
        }
        JsonNode before = data.read(tenant, "group-chats/" + id + "/management");
        TenantNodeModels.CommandResult result;
        String event;
        switch (method) {
            case "nickname" -> {
                result = data.write(tenant, "PATCH", "/members/me/nickname", id, "SET_NICKNAME",
                    Map.of("nickname", ((GroupChatNicknameRequest) args[1]).getNickname()));
                event = "MEMBER_UPDATED";
            }
            case "changeRole", "transferOwnership" -> {
                boolean transfer = "transferOwnership".equals(method);
                Long target = transfer ? ((GroupChatTransferOwnershipRequest) args[1]).getUserId() : (Long) args[2];
                if ((!transfer && !"USER".equals(args[1])) || target == null
                    || memberships.selectActiveMembership(target, tenant.enterpriseId()) == null)
                    throw new IllegalArgumentException("Target must be an active tenant user");
                Map<String, Object> payload = new HashMap<>();
                payload.put("userId", target.toString());
                if (!transfer) payload.put("role", ((Map<?, ?>) args[3]).get("role"));
                // Node rechecks the persisted member; the tenant assertion includes the target.
                result = data.write(tenant, transfer ? "POST" : "PATCH", transfer ? "/owner" : "/members/role",
                    id, transfer ? "TRANSFER_OWNER" : "SET_ROLE", payload);
                event = transfer ? "OWNERSHIP_TRANSFERRED" : "MEMBER_UPDATED";
            }
            case "leave" -> {
                result = data.write(tenant, "POST", "/leave", id, "LEAVE_GROUP", Map.of());
                event = "MEMBER_REMOVED";
            }
            case "dissolve" -> {
                result = data.write(tenant, "POST", "/dissolve", id, "DISSOLVE_GROUP", Map.of());
                event = "GROUP_DISSOLVED";
            }
            case "recall" -> {
                String messageId = args[1].toString();
                result = data.write(tenant, "POST", "/messages/" + messageId + "/recall", id,
                    "RECALL_MESSAGE", Map.of("messageId", messageId));
                event = "MESSAGE_RECALLED";
            }
            case "directSession" -> {
                return data.write(tenant, "POST", "/direct-sessions", id, "CREATE_DIRECT_SESSION",
                    Map.of("agentId", ((DirectSessionCreateRequest) args[1]).getAgentId().toString())).data();
            }
            default -> throw new IllegalArgumentException("Unknown tenant group operation");
        }
        JSONObject notification = new JSONObject();
        notification.put("type", "GROUP_CHAT_EVENT");
        notification.put("event", event);
        notification.put("sessionId", id);
        if (result.data() != null) {
            JsonNode value = result.data();
            if (value.has("messageId")) notification.put("messageId", value.get("messageId").asText());
            if (value.has("recalled")) notification.put("recalled", value.get("recalled").asBoolean());
            if (value.has("recall")) notification.put("recall", mapper.convertValue(value.get("recall"), Map.class));
            for (JsonNode task : value.path("tasks")) tasks.stop(tenant, task);
        }
        if ("transferOwnership".equals(method)) notification.put("recipientUserId",
            ((GroupChatTransferOwnershipRequest) args[1]).getUserId().toString());
        events.publishTenantMembers(tenant, notification, mapper.convertValue(before.path("members"), List.class));
        if ("nickname".equals(method)) return result.data();
        return "recall".equals(method) ? notification : null;
    }
}
