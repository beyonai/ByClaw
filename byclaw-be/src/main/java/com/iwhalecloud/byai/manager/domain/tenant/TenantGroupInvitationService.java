package com.iwhalecloud.byai.manager.domain.tenant;

import com.fasterxml.jackson.databind.JsonNode;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatInvitationTokenRequest;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import java.security.SecureRandom;
import java.util.Map;
import org.springframework.stereotype.Service;

/** 邀请码由 BE 生成；租户群记录和二次入群校验由 Node 持久化负责。 */
@Service
public class TenantGroupInvitationService {
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final String ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    private final TenantGroupData data;
    private final UserService users;
    private final AuthApplicationService grants;
    private final GroupChatEventPublisher events;

    public TenantGroupInvitationService(TenantGroupData data, UserService users,
        AuthApplicationService grants, GroupChatEventPublisher events) {
        this.data = data;
        this.users = users;
        this.grants = grants;
        this.events = events;
    }

    public Object handle(TenantRequestContext tenant, String method, Object[] args) {
        if ("createInvitation".equals(method)) {
            ((jakarta.servlet.http.HttpServletResponse) args[1]).setHeader("Cache-Control", "no-store");
            return data.write(tenant, "POST", "/invitations", args[0].toString(), "CREATE_INVITATION", Map.of("token", token())).data();
        }
        String token = ((GroupChatInvitationTokenRequest) args[0]).getToken();
        JsonNode preview = data.query(tenant, "group-chats/invitations/validate", Map.of("token", token));
        var inviter = users.findById(preview.path("inviterId").asLong());
        if (inviter == null || !"A".equals(inviter.getState()) || "Y".equals(inviter.getIsLocked())
            || inviter.getUserExpDate() != null && inviter.getUserExpDate().getTime() <= System.currentTimeMillis())
            throw new IllegalArgumentException("Invitation is invalid or expired");
        if ("validateInvitation".equals(method)) {
            ((jakarta.servlet.http.HttpServletResponse) args[1]).setHeader("Cache-Control", "no-store");
            ((com.fasterxml.jackson.databind.node.ObjectNode) preview).remove("inviterId");
            return preview;
        }
        String id = preview.path("groupNumber").asText();
        String name = CurrentUserHolder.getCurrentUserName();
        data.write(tenant, "POST", "/join", id, "JOIN_GROUP", Map.of("token", token,
            "joinLinkAuthorized", true, "memName", name == null ? "" : name));
        JsonNode members = data.read(tenant, "group-chats/" + id).path("members");
        java.util.List<Long> agentIds = new java.util.ArrayList<>();
        JsonNode result = null;
        for (JsonNode member : members) {
            if ("AGENT".equals(member.path("memObjType").asText())) agentIds.add(member.path("memObjId").asLong());
            if ("USER".equals(member.path("memObjType").asText()) && member.path("memObjId").asLong() == tenant.userId()) result = member;
        }
        if (!agentIds.isEmpty()) grants.grantDigitalEmployeesToUser(agentIds, tenant.userId());
        var event = new com.alibaba.fastjson.JSONObject();
        event.put("type", "GROUP_CHAT_EVENT");
        event.put("event", "MEMBER_ADDED");
        event.put("sessionId", id);
        events.publishTenant(tenant, Long.valueOf(id), event);
        return result;
    }

    private String token() {
        StringBuilder value = new StringBuilder(8);
        for (int i = 0; i < 8; i++) value.append(ALPHABET.charAt(RANDOM.nextInt(ALPHABET.length())));
        return value.toString();
    }
}
