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
    private final com.iwhalecloud.byai.manager.mapper.message.MessageShareLinkMapper links;
    private final TenantAdminMemberService memberships;

    public TenantGroupInvitationService(TenantGroupData data, UserService users,
        AuthApplicationService grants, GroupChatEventPublisher events,
        com.iwhalecloud.byai.manager.mapper.message.MessageShareLinkMapper links, TenantAdminMemberService memberships) {
        this.data = data;
        this.users = users;
        this.grants = grants;
        this.events = events;
        this.links = links;
        this.memberships = memberships;
    }

    /** Public invitations resolve the tenant from server-owned metadata, never from a browser selector. */
    public TenantRequestContext resolve(String method, Object[] args, TenantRequestContext fallback) {
        if ("createInvitation".equals(method)) return fallback;
        String token = ((GroupChatInvitationTokenRequest) args[0]).getToken();
        if (token == null || !token.matches("[A-Za-z0-9]{8}"))
            throw new IllegalArgumentException("Invitation is invalid or expired");
        var link = links.selectInvitationByToken(token);
        String hint = ((GroupChatInvitationTokenRequest) args[0]).getEnterpriseId();
        if (hint != null && (link == null || !hint.equals(String.valueOf(link.getComAcctId()))))
            throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.BAD_REQUEST,
                "Invitation tenant mismatch");
        if (link == null) return fallback;
        if (link.getComAcctId() == null || link.getComAcctId() <= 1) return null;
        if (!"ACTIVE".equals(link.getStatus()) || link.getCreatorId() == null
            || link.getExpireTime() == null || !link.getExpireTime().isAfter(java.time.LocalDateTime.now()))
            throw new IllegalArgumentException("Invitation is invalid or expired");
        if ("joinInvitation".equals(method)) {
            Long caller = CurrentUserHolder.getCurrentUserId();
            if (caller == null || caller <= 0)
                throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.UNAUTHORIZED,
                    "Login required");
            return new TenantRequestContext(caller, link.getComAcctId(), "MEMBER");
        }
        Long userId = CurrentUserHolder.getCurrentUserId();
        return new TenantRequestContext(userId != null && userId > 0 ? userId : link.getCreatorId(),
            link.getComAcctId(), "MEMBER");
    }

    private void index(TenantRequestContext tenant, long groupId, JsonNode invitation) {
        var existing = links.selectInvitationBySessionId(groupId);
        if (existing != null && !java.util.Objects.equals(existing.getComAcctId(), tenant.enterpriseId()))
            throw new IllegalStateException("Invitation identity conflict");
        var link = new com.iwhalecloud.byai.manager.entity.message.MessageShareLink();
        link.setLinkType("GROUP_INVITATION");
        link.setLinkId(groupId);
        link.setLinkToken(invitation.path("token").asText());
        link.setCreatorId(tenant.userId());
        link.setComAcctId(tenant.enterpriseId());
        link.setStatus("ACTIVE");
        link.setAccessPermission("PUBLIC");
        var now = java.time.LocalDateTime.now();
        link.setCreateTime(now);
        link.setUpdateTime(now);
        link.setCurrentAccessCount(0L);
        link.setExpireTime(java.time.LocalDateTime.ofInstant(java.time.Instant.ofEpochMilli(
            invitation.path("expiresAt").asLong()), java.time.ZoneId.systemDefault()));
        if ((existing == null ? links.insert(link) : links.updateInvitation(link)) != 1)
            throw new IllegalStateException("Unable to save invitation routing");
    }

    @org.springframework.transaction.annotation.Transactional
    public Object handle(TenantRequestContext tenant, String method, Object[] args) {
        if ("createInvitation".equals(method)) {
            ((jakarta.servlet.http.HttpServletResponse) args[1]).setHeader("Cache-Control", "no-store");
            JsonNode invitation = data.write(tenant, "POST", "/invitations", args[0].toString(),
                "CREATE_INVITATION", Map.of("token", token())).data();
            index(tenant, Long.parseLong(args[0].toString()), invitation);
            ((com.fasterxml.jackson.databind.node.ObjectNode) invitation).put("enterpriseId", Long.toString(tenant.enterpriseId()));
            return invitation;
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
            ((com.fasterxml.jackson.databind.node.ObjectNode) preview).put("enterpriseId", Long.toString(tenant.enterpriseId()));
            if (CurrentUserHolder.getCurrentUserId() == null || CurrentUserHolder.getCurrentUserId() <= 0)
                ((com.fasterxml.jackson.databind.node.ObjectNode) preview).put("alreadyMember", false);
            return preview;
        }
        var user = users.findById(tenant.userId());
        if (user == null || !"A".equals(user.getState()) || "Y".equals(user.getIsLocked())
            || user.getUserExpDate() != null && user.getUserExpDate().getTime() <= System.currentTimeMillis())
            throw new IllegalArgumentException("Login required");
        memberships.joinByInvitation(tenant.enterpriseId(), preview.path("inviterId").asLong());
        // The package row lock remains held by this transaction: re-read after admission so
        // concurrent retries observe the first join and do not repeat writes or member events.
        preview = data.query(tenant, "group-chats/invitations/validate", Map.of("token", token));
        String id = preview.path("groupNumber").asText();
        String name = CurrentUserHolder.getCurrentUserName();
        boolean alreadyMember = preview.path("alreadyMember").asBoolean();
        TenantNodeModels.CommandResult joined = null;
        if (!alreadyMember) joined = data.write(tenant, "POST", "/join", id, "JOIN_GROUP", Map.of("token", token,
            "joinLinkAuthorized", true, "memName", name == null ? "" : name));
        JsonNode members = data.read(tenant, "group-chats/" + id).path("members");
        java.util.List<Long> agentIds = new java.util.ArrayList<>();
        JsonNode result = null;
        for (JsonNode member : members) {
            if ("AGENT".equals(member.path("memObjType").asText())) agentIds.add(member.path("memObjId").asLong());
            if ("USER".equals(member.path("memObjType").asText()) && member.path("memObjId").asLong() == tenant.userId()) result = member;
        }
        if (result == null) throw new IllegalStateException("Tenant group join could not be confirmed");
        if (!agentIds.isEmpty()) grants.grantDigitalEmployeesToUser(agentIds, tenant.userId());
        if (!alreadyMember) TenantGroupMembershipEvents.publish(events, tenant, Long.valueOf(id), joined);
        ((com.fasterxml.jackson.databind.node.ObjectNode) result).put("enterpriseId", Long.toString(tenant.enterpriseId()));
        return result;
    }

    private String token() {
        StringBuilder value = new StringBuilder(8);
        for (int i = 0; i < 8; i++) value.append(ALPHABET.charAt(RANDOM.nextInt(ALPHABET.length())));
        return value.toString();
    }
}
