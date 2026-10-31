package com.iwhalecloud.byai.state.domain.groupchat.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.doAnswer;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.domain.tenant.TenantModeService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContext;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantMembershipMapper;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantMembershipRow;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatListItemResponse;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class AggregatedGroupChatServiceTest {
    private final TenantMembershipMapper memberships = mock(TenantMembershipMapper.class);
    private final TenantModeService modes = mock(TenantModeService.class);
    private final TenantNodeClient node = mock(TenantNodeClient.class);
    private final GroupChatReadService publicGroups = mock(GroupChatReadService.class);
    private final AggregatedGroupChatService service = new AggregatedGroupChatService(memberships, modes, node,
        publicGroups, new ObjectMapper());

    @AfterEach
    void clear() {
        CurrentUserHolder.setLoginInfo(null);
        service.shutdown();
    }

    @Test
    void oneTenantFailureDoesNotHideOtherTenantResults() {
        login(7L);
        when(memberships.selectAvailableForUser(7L)).thenReturn(List.of(tenant("11", "可用企业"), tenant("12", "异常企业")));
        when(modes.isSharedDataTenant(11L)).thenReturn(false);
        when(modes.isSharedDataTenant(12L)).thenReturn(false);
        when(publicGroups.listMyGroupsInEnterprise(7L, 1, 20, null)).thenReturn(new PageInfo<>());
        doAnswer(invocation -> {
            TenantRequestContext context = invocation.getArgument(0);
            if (context.enterpriseId() == 12L) {
                throw new ResponseStatusException(org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE);
            }
            return Map.of("list", List.of(Map.of("sessionId", "1101", "name", "可用群")));
        }).when(node).request(any(TenantRequestContext.class), eq("GET"),
            eq("/internal/v1/group-chats?pageNum=1&pageSize=20"), eq(null), any());

        var result = service.list(20, null);

        assertThat(result.items()).hasSize(1);
        assertThat(result.items().getFirst().getEnterpriseId()).isEqualTo(11L);
        assertThat(result.failedTenants()).singleElement().extracting("enterpriseId").isEqualTo("12");
        assertThat(result.partial()).isTrue();
    }

    @Test
    void cursorIsReturnedWhenAChildTenantHasMoreRows() {
        login(7L);
        when(memberships.selectAvailableForUser(7L)).thenReturn(List.of(tenant("11", "企业")));
        when(modes.isSharedDataTenant(11L)).thenReturn(true);
        PageInfo<GroupChatListItemResponse> page = new PageInfo<>();
        page.setList(List.of(group(1101L, "群组")));
        when(publicGroups.listMyGroupsInEnterprise(7L, 1, 1, null)).thenReturn(page);

        var result = service.list(1, null);

        assertThat(result.items()).hasSize(1);
        assertThat(result.hasMore()).isTrue();
        assertThat(result.nextCursor()).isNotBlank();
    }

    @Test
    void sharedGroupsUseTheirOwnCursorPageWithoutRepeatingTheFirstPage() {
        login(7L);
        when(memberships.selectAvailableForUser(7L)).thenReturn(List.of());
        PageInfo<GroupChatListItemResponse> first = new PageInfo<>();
        first.setList(List.of(group(1001L, "第一组"), group(1002L, "第二组")));
        PageInfo<GroupChatListItemResponse> second = new PageInfo<>();
        second.setList(List.of(group(1003L, "第三组")));
        when(publicGroups.listMyGroupsInEnterprise(7L, 1, 2, null)).thenReturn(first);
        when(publicGroups.listMyGroupsInEnterprise(7L, 2, 2, null)).thenReturn(second);

        var firstPage = service.list(2, null);
        var secondPage = service.list(2, firstPage.nextCursor());

        assertThat(firstPage.items()).extracting(GroupChatListItemResponse::getSessionId)
            .containsExactly(1001L, 1002L);
        assertThat(secondPage.items()).extracting(GroupChatListItemResponse::getSessionId)
            .containsExactly(1003L);
    }

    @Test
    void sharedHistoricalGroupFallsBackToDefaultPublicRouting() {
        login(7L);
        when(memberships.selectAvailableForUser(7L)).thenReturn(List.of(tenant("11389605", "免费试用")));
        when(modes.isSharedDataTenant(11389605L)).thenReturn(true);
        GroupChatListItemResponse historical = group(11231123L, "历史群");
        historical.setEnterpriseId(11227835L);
        historical.setEnterpriseName("已删除企业");
        PageInfo<GroupChatListItemResponse> page = new PageInfo<>();
        page.setList(List.of(historical));
        when(publicGroups.listMyGroupsInEnterprise(7L, 1, 20, null)).thenReturn(page);

        var result = service.list(20, null);

        assertThat(result.items()).singleElement().satisfies(item -> {
            assertThat(item.getEnterpriseId()).isEqualTo(11227835L);
            assertThat(item.getEnterpriseName()).isEqualTo("已删除企业");
            assertThat(item.getRoutingEnterpriseId()).isEqualTo(1L);
        });
    }

    @Test
    void sharedTrialGroupKeepsTrialRouting() {
        login(7L);
        when(memberships.selectAvailableForUser(7L)).thenReturn(List.of(tenant("11389605", "免费试用")));
        when(modes.isSharedDataTenant(11389605L)).thenReturn(true);
        GroupChatListItemResponse trial = group(11393965L, "试用群");
        trial.setEnterpriseId(11389605L);
        PageInfo<GroupChatListItemResponse> page = new PageInfo<>();
        page.setList(List.of(trial));
        when(publicGroups.listMyGroupsInEnterprise(7L, 1, 20, null)).thenReturn(page);

        var result = service.list(20, null);

        assertThat(result.items()).singleElement().extracting(GroupChatListItemResponse::getRoutingEnterpriseId)
            .isEqualTo(11389605L);
    }

    private static void login(long userId) {
        LoginInfo login = new LoginInfo();
        login.setUserId(userId);
        CurrentUserHolder.setLoginInfo(login);
    }

    private static TenantMembershipRow tenant(String id, String name) {
        TenantMembershipRow row = new TenantMembershipRow();
        row.setEnterpriseId(id);
        row.setEnterpriseName(name);
        return row;
    }

    private static GroupChatListItemResponse group(long id, String name) {
        GroupChatListItemResponse group = new GroupChatListItemResponse();
        group.setSessionId(id);
        group.setName(name);
        return group;
    }
}
