package com.iwhalecloud.byai.manager.domain.tenant;

import com.fasterxml.jackson.core.type.TypeReference;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatMentionMapper;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantMembershipMapper;
import com.iwhalecloud.byai.manager.mapper.users.UsersMapper;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatMemberRequest;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/** Validates group invitations against the group owner and the shared resource catalog. */
@Service
public class TenantGroupMemberService {
    private final TenantNodeClient node;
    private final ByaiGroupChatMentionMapper legacyMembership;
    private final GroupChatAuthorizationService legacyAuthorization;
    private final SsResourceService resources;
    private final AuthApplicationService resourceAuthorization;
    private final TenantMembershipMapper tenantMemberships;
    private final UsersMapper users;

    public TenantGroupMemberService(TenantNodeClient node, ByaiGroupChatMentionMapper legacyMembership,
        GroupChatAuthorizationService legacyAuthorization, SsResourceService resources,
        AuthApplicationService resourceAuthorization, TenantMembershipMapper tenantMemberships,
        UsersMapper users) {
        this.node = node;
        this.legacyMembership = legacyMembership;
        this.legacyAuthorization = legacyAuthorization;
        this.resources = resources;
        this.resourceAuthorization = resourceAuthorization;
        this.tenantMemberships = tenantMemberships;
        this.users = users;
    }

    public void requireInvite(Long sessionId, String type) {
        TenantRequestContext context = TenantRequestContextHolder.get();
        if (context == null || legacyMembership.isLegacyGroupMember(sessionId,
            context.userId(), context.enterpriseId())) {
            legacyAuthorization.requireInvite(sessionId, type);
            return;
        }
        requireInvite(context, sessionId, type);
    }

    public List<Map<String, Object>> invite(TenantRequestContext context, Long sessionId,
        GroupChatMemberRequest request) {
        if (request == null || !("AGENT".equals(request.getType()) || "USER".equals(request.getType()))
            || request.getId() == null
            || request.getId().isEmpty() || request.getId().size() > 100
            || request.getId().stream().anyMatch(id -> id == null || id <= 0)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid group invitation");
        }
        String type = request.getType();
        Map<String, Object> detail = requireInvite(context, sessionId, type);
        List<TenantNodeModels.InvitedMember> members = request.getId().stream().distinct().map(id -> {
            if ("USER".equals(type)) {
                Users user = users.selectById(id);
                if (user == null || tenantMemberships.selectActiveMembership(id, context.enterpriseId()) == null) {
                    throw new ResponseStatusException(HttpStatus.FORBIDDEN, "user is not an active tenant member");
                }
                return new TenantNodeModels.InvitedMember("USER", id.toString(), user.getUserName(), false);
            }
            SsResource resource = resources.findById(id);
            if (resource == null || !"DIG_EMPLOYEE".equals(resource.getResourceBizType())
                || !Objects.equals(resource.getResourceStatus(), 2)
                || !("enterprise".equalsIgnoreCase(resource.getOwnerType())
                    || resourceAuthorization.hasResourceAccessPermission(resource))) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "digital employee is not accessible");
            }
            return new TenantNodeModels.InvitedMember("AGENT", id.toString(), resource.getResourceName(), true);
        }).toList();
        String id = sessionId.toString();
        if ("USER".equals(type)) {
            List<String> tenantMemberIds = new java.util.ArrayList<>();
            tenantMemberIds.add(Long.toString(context.userId()));
            members.stream().map(TenantNodeModels.InvitedMember::memObjId).distinct()
                .filter(memberId -> !memberId.equals(Long.toString(context.userId())))
                .forEach(tenantMemberIds::add);
            node.command(context, "POST", "/internal/v1/group-chats/" + id + "/members", id,
                "ADD_MEMBERS", new TenantNodeModels.AddMembers(members), UUID.randomUUID().toString(),
                tenantMemberIds);
            List<Long> agentIds = rows(detail.get("members")).stream()
                .filter(member -> "AGENT".equals(member.get("memObjType")))
                .map(member -> Long.valueOf(member.get("memObjId").toString())).toList();
            for (Long userId : request.getId().stream().distinct().toList()) {
                if (!agentIds.isEmpty()) resourceAuthorization.grantDigitalEmployeesToUser(agentIds, userId);
            }
        }
        else {
            node.command(context, "POST", "/internal/v1/group-chats/" + id + "/members", id,
                "ADD_MEMBERS", new TenantNodeModels.AddMembers(members));
            for (Map<String, Object> member : rows(detail.get("members"))) {
                if ("USER".equals(member.get("memObjType"))) {
                    Long userId = Long.valueOf(member.get("memObjId").toString());
                    resourceAuthorization.grantDigitalEmployeesToUser(request.getId(), userId);
                }
            }
        }
        return rows(nodeDetail(context, sessionId).get("members")).stream()
            .filter(member -> type.equals(member.get("memObjType"))
                && request.getId().stream().anyMatch(idValue -> idValue.toString().equals(member.get("memObjId"))))
            .toList();
    }

    private Map<String, Object> requireInvite(TenantRequestContext context, Long sessionId, String type) {
        if (sessionId == null || sessionId <= 0 || !("AGENT".equals(type) || "USER".equals(type))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid group invitation");
        }
        Map<String, Object> detail = nodeDetail(context, sessionId);
        boolean allowed = rows(detail.get("members")).stream()
            .anyMatch(member -> "USER".equals(member.get("memObjType"))
                && Long.toString(context.userId()).equals(String.valueOf(member.get("memObjId")))
                && ("OWNER".equals(member.get("userRole")) || "ADMIN".equals(member.get("userRole"))
                    || detail.get("settings") instanceof Map<?, ?> settings
                        && Boolean.TRUE.equals(settings.get("AGENT".equals(type)
                            ? "allowMemberAddAgent" : "allowMemberInviteUser"))));
        if (!allowed) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "group member invitation is disabled");
        return detail;
    }

    private Map<String, Object> nodeDetail(TenantRequestContext context, Long sessionId) {
        return node.request(context, "GET", "/internal/v1/group-chats/" + sessionId, null,
            new TypeReference<Map<String, Object>>() { });
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> rows(Object value) {
        return value instanceof List<?> list ? (List<Map<String, Object>>) list : List.of();
    }
}
