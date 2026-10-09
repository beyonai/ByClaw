package com.iwhalecloud.byai.manager.domain.tenant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

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
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class TenantGroupMemberServiceTest {
    private final TenantNodeClient node = mock(TenantNodeClient.class);
    private final ByaiGroupChatMentionMapper legacyMembership = mock(ByaiGroupChatMentionMapper.class);
    private final GroupChatAuthorizationService legacyAuthorization = mock(GroupChatAuthorizationService.class);
    private final SsResourceService resources = mock(SsResourceService.class);
    private final AuthApplicationService resourceAuthorization = mock(AuthApplicationService.class);
    private final TenantMembershipMapper tenantMemberships = mock(TenantMembershipMapper.class);
    private final UsersMapper users = mock(UsersMapper.class);
    private final TenantGroupMemberService service = new TenantGroupMemberService(node, legacyMembership,
        legacyAuthorization, resources, resourceAuthorization, tenantMemberships, users);
    private final TenantRequestContext context = new TenantRequestContext(57L, 11221076L, "MEMBER");
    private final Long groupId = 2104891116955410432L;

    @AfterEach
    void clear() {
        TenantRequestContextHolder.clear();
    }

    @Test
    void queryAuthorizesTenantGroupWithoutLookingInLegacyGroupDatabase() {
        TenantRequestContextHolder.set(context);
        when(node.request(eq(context), eq("GET"), eq(path()), eq(null), any())).thenReturn(detail());

        service.requireInvite(groupId, "AGENT");

        verify(legacyAuthorization, never()).requireInvite(groupId, "AGENT");
    }

    @Test
    void inviteWritesAuthorizedAgentToTenantNodeAndGrantsGroupUsers() {
        when(node.request(eq(context), eq("GET"), eq(path()), eq(null), any())).thenReturn(detail(),
            Map.of("members", List.of(Map.of("memObjType", "AGENT", "memObjId", "10000713"))));
        SsResource resource = new SsResource();
        resource.setResourceId(10000713L);
        resource.setResourceBizType("DIG_EMPLOYEE");
        resource.setResourceStatus(2);
        resource.setResourceName("文章创作助手");
        resource.setComAcctId(11221076L);
        resource.setOwnerType("enterprise");
        when(resources.findById(10000713L)).thenReturn(resource);
        when(resourceAuthorization.hasResourceAccessPermission(resource)).thenReturn(true);
        GroupChatMemberRequest request = new GroupChatMemberRequest();
        request.setType("AGENT");
        request.setId(List.of(10000713L));

        assertThat(service.invite(context, groupId, request)).hasSize(1);

        verify(node).command(eq(context), eq("POST"), eq(path() + "/members"), eq(groupId.toString()),
            eq("ADD_MEMBERS"), any(TenantNodeModels.AddMembers.class));
        verify(resourceAuthorization).grantDigitalEmployeesToUser(List.of(10000713L), 57L);
    }

    @Test
    void initialAgentValidationMarksAccessibleResourcesForNodeCreate() {
        SsResource resource = new SsResource();
        resource.setResourceId(10000713L);
        resource.setResourceBizType("DIG_EMPLOYEE");
        resource.setResourceStatus(2);
        resource.setResourceName("文章创作助手");
        resource.setOwnerType("enterprise");
        resource.setComAcctId(context.enterpriseId());
        when(resources.findById(10000713L)).thenReturn(resource);

        assertThat(service.initialAgents(context, List.of(10000713L))).containsExactly(
            new TenantNodeModels.GroupMember("AGENT", "10000713", "MEMBER", "文章创作助手", true));
    }

    @Test
    void initialAgentValidationRejectsInaccessibleResources() {
        SsResource resource = new SsResource();
        resource.setResourceBizType("DIG_EMPLOYEE");
        resource.setResourceStatus(2);
        resource.setOwnerType("personal");
        when(resources.findById(10000713L)).thenReturn(resource);

        assertThatThrownBy(() -> service.initialAgents(context, List.of(10000713L)))
            .isInstanceOf(ResponseStatusException.class);
    }

    @Test
    void privateAgentWithoutAccessCannotBeAdded() {
        when(node.request(eq(context), eq("GET"), eq(path()), eq(null), any())).thenReturn(detail());
        SsResource resource = new SsResource();
        resource.setResourceBizType("DIG_EMPLOYEE");
        resource.setResourceStatus(2);
        resource.setComAcctId(11221859L);
        resource.setOwnerType("personal");
        when(resources.findById(10000713L)).thenReturn(resource);
        GroupChatMemberRequest request = new GroupChatMemberRequest();
        request.setType("AGENT");
        request.setId(List.of(10000713L));

        assertThatThrownBy(() -> service.invite(context, groupId, request))
            .isInstanceOf(ResponseStatusException.class);
        verify(node, never()).command(eq(context), eq("POST"), any(), any(), any(), any());
    }

    @Test
    void inviteActiveTenantUserWritesMembershipAssertionAndGrantsExistingAgents() {
        Map<String, Object> existingAgent = Map.of("memObjType", "AGENT", "memObjId", "10000713");
        Map<String, Object> owner = Map.of("memObjType", "USER", "memObjId", "57", "userRole", "OWNER");
        Map<String, Object> invited = Map.of("memObjType", "USER", "memObjId", "91", "userRole", "MEMBER");
        when(node.request(eq(context), eq("GET"), eq(path()), eq(null), any())).thenReturn(
            Map.of("members", List.of(owner, existingAgent), "settings", Map.of("allowMemberInviteUser", false)),
            Map.of("members", List.of(owner, existingAgent, invited)));
        Users user = new Users();
        user.setUserId(91L);
        user.setUserName("杜甫");
        when(users.selectById(91L)).thenReturn(user);
        when(tenantMemberships.selectActiveMembership(91L, context.enterpriseId()))
            .thenReturn(new com.iwhalecloud.byai.manager.mapper.tenant.TenantMembershipRow());
        GroupChatMemberRequest request = new GroupChatMemberRequest();
        request.setType("USER");
        request.setId(List.of(91L));

        assertThat(service.invite(context, groupId, request)).hasSize(1);

        org.mockito.ArgumentCaptor<List<String>> memberIds = org.mockito.ArgumentCaptor.forClass(List.class);
        verify(node).command(eq(context), eq("POST"), eq(path() + "/members"), eq(groupId.toString()),
            eq("ADD_MEMBERS"), any(TenantNodeModels.AddMembers.class), any(), memberIds.capture());
        assertThat(memberIds.getValue()).containsExactly("57", "91");
        verify(resourceAuthorization).grantDigitalEmployeesToUser(List.of(10000713L), 91L);
    }

    private String path() {
        return "/internal/v1/group-chats/" + groupId;
    }

    private Map<String, Object> detail() {
        return Map.of("members", List.of(Map.of("memObjType", "USER", "memObjId", "57",
            "userRole", "OWNER")), "settings", Map.of("allowMemberAddAgent", false));
    }
}
