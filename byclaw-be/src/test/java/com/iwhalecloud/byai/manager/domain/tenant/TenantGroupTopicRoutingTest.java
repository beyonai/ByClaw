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
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatTopicListResponse;
import org.springframework.web.server.ResponseStatusException;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTopicQueryService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatReadService;
import com.iwhalecloud.byai.state.domain.groupchat.interfaces.GroupChatTopicController;

/** 通过真实 AOP 代理确认文件接口按租户路由，不回退本地消息表。 */
class TenantGroupTopicRoutingTest {
    @AfterEach
    void clear() {
        TenantRequestContextHolder.clear();
    }

    @Test
    void tenantTopicsUseTopicCollectionAndExactSessionIds() {
        var node = mock(TenantNodeClient.class);
        var local = mock(GroupChatTopicQueryService.class);
        var messages = mock(com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTopicMessagesService.class);
        var context = new TenantRequestContext(27L, 11221076L, "MEMBER");
        TenantRequestContextHolder.set(context);
        var aspect = new TenantGroupChatRoutingAspect(node, mock(GroupChatReadService.class),
            mock(ByaiGroupChatMentionMapper.class), new ObjectMapper(), mock(TenantGroupMemberService.class));
        var factory = new AspectJProxyFactory(new GroupChatTopicController(local, messages));
        factory.setProxyTargetClass(true);
        factory.addAspect(aspect);
        GroupChatTopicController controller = factory.getProxy();
        var page = Map.of("items", java.util.List.of(), "hasMore", false);
        when(node.request(eq(context), eq("GET"),
            eq("/internal/v1/group-chats/2108809138493460480/topics?limit=20"), eq(null), any())).thenReturn(page);
        ResponseUtil<?> response = controller.list(2108809138493460480L, 20, null);
        assertThat(response.getData()).isEqualTo(page);
        verifyNoInteractions(local, messages);
    }
}
