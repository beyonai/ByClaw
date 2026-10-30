package com.iwhalecloud.byai.manager.domain.tenant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.alibaba.fastjson.JSONObject;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatMentionMapper;
import com.iwhalecloud.byai.state.domain.groupchat.application.*;
import com.iwhalecloud.byai.state.domain.chat.service.GroupChatContextService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatRecallUndoRequest;
import com.iwhalecloud.byai.state.domain.groupchat.interfaces.GroupChatController;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.aop.aspectj.annotation.AspectJProxyFactory;
import org.springframework.http.MediaType;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

/** 用真实路由代理确认租户恢复不访问共享消息表，并检查公开 HTTP 的必填时间。 */
class TenantGroupRecallUndoRoutingTest {
    @AfterEach
    void clear() { TenantRequestContextHolder.clear(); }

    @Test
    void tenantUndoRoutesToManagementWithoutCallingLocalRecall() {
        var local = mock(GroupChatMessageRecallService.class);
        var management = mock(TenantGroupManagementService.class);
        var controller = controller(local);
        var aspect = new TenantGroupChatRoutingAspect(mock(TenantNodeClient.class), mock(GroupChatReadService.class),
            mock(ByaiGroupChatMentionMapper.class), new ObjectMapper(), mock(TenantGroupMemberService.class),
            mock(TenantModeService.class));
        ReflectionTestUtils.setField(aspect, "management", management);
        var factory = new AspectJProxyFactory(controller);
        factory.setProxyTargetClass(true);
        factory.addAspect(aspect);
        GroupChatController proxy = factory.getProxy();
        var tenant = new TenantRequestContext(77L, 10L, "MEMBER");
        TenantRequestContextHolder.set(tenant);
        var request = new GroupChatRecallUndoRequest();
        request.setRecalledAt(1000L);
        JSONObject result = new JSONObject();
        result.put("recalled", false);
        when(management.change(eq(tenant), eq("undoRecall"), eq(30L), any())).thenReturn(result);
        assertThat(proxy.undoRecall(30L, 90L, request).getData()).isSameAs(result);
        verifyNoInteractions(local);
    }

    @Test
    void httpUndoRequiresTheRecallTimestampAndDispatchesValidBody() throws Exception {
        var local = mock(GroupChatMessageRecallService.class);
        var mvc = MockMvcBuilders.standaloneSetup(controller(local)).build();
        String path = "/group-chats/30/messages/90/recall/undo";
        for (String body : new String[]{"{}", "{\"recalledAt\":null}", "{\"recalledAt\":0}", "{\"recalledAt\":-1}"}) {
            mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isBadRequest());
        }
        verifyNoInteractions(local);
        when(local.undoRecall(30L, 90L, 1000L)).thenReturn(new JSONObject());
        mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).content("{\"recalledAt\":1000}"))
            .andExpect(status().isOk());
        verify(local).undoRecall(30L, 90L, 1000L);
    }

    private GroupChatController controller(GroupChatMessageRecallService local) {
        var controller = new GroupChatController(mock(GroupChatApplicationService.class), mock(GroupChatContextService.class),
            mock(GroupChatTaskService.class), mock(GroupChatReadService.class), mock(GroupChatMessageAckService.class));
        ReflectionTestUtils.setField(controller, "recallService", local);
        return controller;
    }
}
