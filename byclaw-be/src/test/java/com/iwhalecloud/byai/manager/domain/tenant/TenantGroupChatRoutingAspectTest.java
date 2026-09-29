package com.iwhalecloud.byai.manager.domain.tenant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import org.mockito.ArgumentCaptor;

import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.GroupCreate;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.RemoveMember;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.CommandResult;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatReadService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatListItemResponse;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatCreateRequest;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatMemberRequest;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextRequest;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatMentionMapper;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.reflect.MethodSignature;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class TenantGroupChatRoutingAspectTest {
    private final TenantNodeClient node = mock(TenantNodeClient.class);
    private final GroupChatReadService legacy = mock(GroupChatReadService.class);
    private final ByaiGroupChatMentionMapper memberships = mock(ByaiGroupChatMentionMapper.class);
    private final TenantGroupMemberService memberService = mock(TenantGroupMemberService.class);
    private final TenantGroupChatRoutingAspect aspect = new TenantGroupChatRoutingAspect(node, legacy, memberships,
        new ObjectMapper(), memberService);

    @AfterEach
    void clear() {
        TenantRequestContextHolder.clear();
    }

    @Test
    void tenantListIncludesItsLegacyMembershipAndNodeGroups() throws Throwable {
        TenantRequestContext context = new TenantRequestContext(27L, 11221076L, "MEMBER");
        TenantRequestContextHolder.set(context);
        GroupChatListItemResponse oldGroup = new GroupChatListItemResponse();
        oldGroup.setSessionId(11221825L);
        oldGroup.setName("国庆冲刺训练营ACE");
        PageInfo<GroupChatListItemResponse> legacyPage = new PageInfo<>();
        legacyPage.setList(List.of(oldGroup));
        legacyPage.setTotal(1);
        when(legacy.listMyGroupsInEnterprise(1, 20, 11221076L)).thenReturn(legacyPage);
        when(node.request(eq(context), eq("GET"), eq("/internal/v1/group-chats?pageNum=1&pageSize=20"),
            eq(null), any())).thenReturn(Map.of("list", List.of(Map.of(
            "sessionId", "9000000000000000001", "name", "联调测试工作组")), "total", 1,
            "pageNum", 1, "pageSize", 20, "totalPages", 1));

        ResponseUtil<?> response = (ResponseUtil<?>) aspect.route(call("list", 1, 20, 11221076L));

        assertThat(response.getCode()).isZero();
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) response.getData();
        assertThat(data.get("total")).isEqualTo(2L);
        assertThat((List<?>) data.get("list")).hasSize(2);
    }

    @Test
    void tenantListRejectsAnotherEnterpriseId() {
        TenantRequestContextHolder.set(new TenantRequestContext(27L, 11221076L, "MEMBER"));

        assertThatThrownBy(() -> aspect.route(call("list", 1, 20, 11221859L)))
            .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
    }

    @Test
    void tenantCreateWritesOnlyToItsNodeAndReturnsTheNewDetail() throws Throwable {
        TenantRequestContext context = new TenantRequestContext(27L, 11221859L, "MEMBER");
        TenantRequestContextHolder.set(context);
        GroupChatCreateRequest request = new GroupChatCreateRequest();
        request.setName("电信验证组");
        request.setGoal("验证租户隔离");
        when(node.command(eq(context), eq("POST"), eq("/internal/v1/group-chats"), any(),
            eq("CREATE_GROUP"), any(GroupCreate.class))).thenReturn(
                new CommandResult("9000000000000000001", "request", "CREATE_GROUP", null));
        when(node.request(eq(context), eq("GET"), any(), eq(null), any())).thenReturn(
            Map.of("session", Map.of("sessionId", "9000000000000000001", "sessionName", "电信验证组")));

        ResponseUtil<?> response = (ResponseUtil<?>) aspect.route(call("create", request));

        assertThat(response.getCode()).isZero();
        verify(node).command(eq(context), eq("POST"), eq("/internal/v1/group-chats"), any(),
            eq("CREATE_GROUP"), any(GroupCreate.class));
    }

    @Test
    void onlyAnExactEnterpriseMemberCanUseTheLegacyGroupHandler() throws Throwable {
        TenantRequestContextHolder.set(new TenantRequestContext(27L, 11221076L, "MEMBER"));
        when(memberships.isLegacyGroupMember(11221825L, 27L, 11221076L)).thenReturn(true);
        ProceedingJoinPoint call = call("detail", 11221825L);
        Object original = ResponseUtil.successResponse("legacy detail");
        when(call.proceed()).thenReturn(original);

        assertThat(aspect.route(call)).isSameAs(original);
        verify(call).proceed();
    }

    @Test
    void tenantContextOmitsAbsentCursorForNewGroups() throws Throwable {
        TenantRequestContext context = new TenantRequestContext(27L, 11221859L, "MEMBER");
        TenantRequestContextHolder.set(context);
        GroupChatContextRequest request = new GroupChatContextRequest();
        request.setMaxMessages(50);
        request.setMaxCharacters(20000);

        aspect.route(call("context", 9000000000000000001L, request));

        ArgumentCaptor<Object> body = ArgumentCaptor.forClass(Object.class);
        verify(node).request(eq(context), eq("POST"),
            eq("/internal/v1/group-chats/9000000000000000001/context"), body.capture(), any());
        assertThat(body.getValue()).isEqualTo(Map.of("maxMessages", 50, "maxCharacters", 20000));
    }

    @Test
    void tenantMessageSearchOmitsNullKeywordAndFilters() throws Throwable {
        TenantRequestContext context = new TenantRequestContext(27L, 11221859L, "MEMBER");
        TenantRequestContextHolder.set(context);
        com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatMessageSearchRequest request =
            new com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatMessageSearchRequest();
        request.setLimit(20);

        aspect.route(call("searchMessages", 9000000000000000001L, request));

        ArgumentCaptor<Object> body = ArgumentCaptor.forClass(Object.class);
        verify(node).request(eq(context), eq("POST"),
            eq("/internal/v1/group-chats/9000000000000000001/messages/search"), body.capture(), any());
        assertThat(body.getValue()).isEqualTo(Map.of("limit", 20));
    }

    @Test
    void tenantInviteRoutesToNodeMembershipService() throws Throwable {
        TenantRequestContext context = new TenantRequestContext(27L, 11221076L, "MEMBER");
        TenantRequestContextHolder.set(context);
        GroupChatMemberRequest request = new GroupChatMemberRequest();
        request.setType("AGENT");
        request.setId(List.of(10000713L));

        aspect.route(call("invite", 9000000000000000001L, request));

        verify(memberService).invite(context, 9000000000000000001L, request);
    }

    @Test
    void tenantRemoveRoutesToNodeWithTargetMember() throws Throwable {
        TenantRequestContext context = new TenantRequestContext(27L, 11221076L, "MEMBER");
        TenantRequestContextHolder.set(context);

        ResponseUtil<?> response = (ResponseUtil<?>) aspect.route(call("remove", 9000000000000000001L,
            "AGENT", 10000713L));

        assertThat(response.getCode()).isZero();
        verify(node).command(context, "DELETE", "/internal/v1/group-chats/9000000000000000001/members",
            "9000000000000000001", "REMOVE_MEMBER", new RemoveMember("AGENT", "10000713"));
    }

    private ProceedingJoinPoint call(String method, Object... args) {
        ProceedingJoinPoint call = mock(ProceedingJoinPoint.class);
        MethodSignature signature = mock(MethodSignature.class);
        when(signature.getMethod()).thenAnswer(invocation -> {
            Class<?>[] parameters = switch (method) {
                case "list" -> new Class<?>[]{Integer.class, Integer.class, Long.class};
                case "create" -> new Class<?>[]{GroupChatCreateRequest.class};
                case "invite" -> new Class<?>[]{Long.class, GroupChatMemberRequest.class};
                case "remove" -> new Class<?>[]{Long.class, String.class, Long.class};
                case "context" -> new Class<?>[]{Long.class, GroupChatContextRequest.class};
                case "searchMessages" -> new Class<?>[]{Long.class,
                    com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatMessageSearchRequest.class};
                default -> new Class<?>[]{Long.class};
            };
            return com.iwhalecloud.byai.state.domain.groupchat.interfaces.GroupChatController.class
                .getMethod(method, parameters);
        });
        when(call.getSignature()).thenReturn(signature);
        when(call.getArgs()).thenReturn(args);
        return call;
    }
}
