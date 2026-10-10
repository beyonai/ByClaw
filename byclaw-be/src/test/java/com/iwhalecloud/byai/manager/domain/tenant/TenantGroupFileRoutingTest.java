package com.iwhalecloud.byai.manager.domain.tenant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.aop.aspectj.annotation.AspectJProxyFactory;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatMentionMapper;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatFileListResponse;
import org.springframework.web.server.ResponseStatusException;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatFileQueryService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatReadService;
import com.iwhalecloud.byai.state.domain.groupchat.interfaces.GroupChatFileController;

/** 通过真实 AOP 代理确认文件接口按租户路由，不回退本地消息表。 */
class TenantGroupFileRoutingTest {
    @AfterEach
    void clear() {
        TenantRequestContextHolder.clear();
    }

    @Test
    void tenantFilePagesUseNodeAndNeverInvokeLocalQuery() {
        var node = mock(TenantNodeClient.class);
        var local = mock(GroupChatFileQueryService.class);
        var context = new TenantRequestContext(27L, 11221076L, "MEMBER");
        TenantRequestContextHolder.set(context);
        GroupChatFileController controller = proxy(node, local);
        var page = Map.of("files", java.util.List.of(), "hasMore", false);
        when(node.request(eq(context), eq("GET"),
            eq("/internal/v1/group-chats/10/files?pageSize=2&cursor=MToxMDoxMDA6MA"), eq(null), any())).thenReturn(page);
        ResponseUtil<?> response = controller.list(10L, 2, "MToxMDoxMDA6MA");
        assertThat(response.getData()).isEqualTo(page);
        verifyNoInteractions(local);
    }

    @Test
    void invalidTenantPaginationDoesNotReachEitherDatabase() {
        var node = mock(TenantNodeClient.class);
        var local = mock(GroupChatFileQueryService.class);
        TenantRequestContextHolder.set(new TenantRequestContext(27L, 11221076L, "MEMBER"));
        GroupChatFileController controller = proxy(node, local);
        assertThatThrownBy(() -> controller.list(10L, 0, null)).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> controller.list(10L, 51, null)).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> controller.list(10L, 2, "!bad")).isInstanceOf(ResponseStatusException.class);
        verifyNoInteractions(local, node);
    }

    @Test
    void localGroupUsesLocalPermissionAndQueryService() {
        var node = mock(TenantNodeClient.class);
        var local = mock(GroupChatFileQueryService.class);
        var page = new GroupChatFileListResponse();
        when(local.list(10L, 2, null)).thenReturn(page);
        assertThat(proxy(node, local).list(10L, 2, null).getData()).isSameAs(page);
        verifyNoInteractions(node);
    }

    private GroupChatFileController proxy(TenantNodeClient node, GroupChatFileQueryService local) {
        var aspect = new TenantGroupChatRoutingAspect(node, mock(GroupChatReadService.class),
            mock(ByaiGroupChatMentionMapper.class), new ObjectMapper(), mock(TenantGroupMemberService.class));
        var factory = new AspectJProxyFactory(new GroupChatFileController(local));
        factory.setProxyTargetClass(true);
        factory.addAspect(aspect);
        return factory.getProxy();
    }
}
