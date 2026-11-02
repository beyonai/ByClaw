package com.iwhalecloud.byai.manager.domain.tenant;

import com.iwhalecloud.byai.common.i18n.I18nTestSupport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatRecallUndoRequest;
import org.junit.jupiter.api.Test;

class TenantGroupManagementRecallTest extends I18nTestSupport {
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.CsvSource({"true,false", "false,false", "true,true"})
    void undoUsesTenantCommandAndOnlyBroadcastsAChangedState(boolean changed, boolean offline) throws Exception {
        var mapper = new ObjectMapper();
        var data = mock(TenantGroupData.class);
        var events = mock(GroupChatEventPublisher.class);
        var tasks = mock(TenantGroupTaskStopService.class);
        var service = new TenantGroupManagementService(data, mapper, events, tasks,
            mock(com.iwhalecloud.byai.manager.mapper.tenant.TenantMembershipMapper.class));
        var tenant = new TenantRequestContext(77L, 10L, "MEMBER");
        when(data.read(eq(tenant), anyString())).thenReturn(mapper.readTree("{\"members\":[]}"));
        var result = mock(TenantNodeModels.CommandResult.class);
        when(result.data()).thenReturn(mapper.readTree("{\"messageId\":\"90\",\"recalled\":false,\"recall\":null,\"changed\":" + changed + "}"));
        when(data.write(eq(tenant), eq("POST"), eq("/messages/90/recall/undo"), eq("30"),
            eq("UNDO_RECALL_MESSAGE"), eq(java.util.Map.of("messageId", "90", "recalledAt", 1000L))))
            .thenReturn(result);
        if (offline) when(events.publishTenantMembers(eq(tenant), any(), anyList()))
            .thenThrow(new IllegalStateException("offline"));
        var request = new GroupChatRecallUndoRequest();
        request.setRecalledAt(1000L);
        var response = (JSONObject) service.change(tenant, "undoRecall", 30L, new Object[]{30L, 90L, request});
        assertThat(response.getBoolean("recalled")).isFalse();
        assertThat(response.getString("event")).isEqualTo("MESSAGE_RECALL_UNDONE");
        assertThat(response).doesNotContainKeys("changed", "content", "tasks");
        if (changed) verify(events).publishTenantMembers(eq(tenant), eq(response), anyList());
        else verifyNoInteractions(events);
        verifyNoInteractions(tasks);
    }

    @Test
    void forwardsRecallIdentityAndContentToTheResponseAndOnlineMembers() throws Exception {
        var mapper = new ObjectMapper();
        var data = mock(TenantGroupData.class);
        var events = mock(GroupChatEventPublisher.class);
        var service = new TenantGroupManagementService(data, mapper, events,
            mock(TenantGroupTaskStopService.class), mock(com.iwhalecloud.byai.manager.mapper.tenant.TenantMembershipMapper.class));
        var tenant = new TenantRequestContext(77L, 10L, "MEMBER");
        when(data.read(eq(tenant), anyString())).thenReturn(mapper.readTree("{\"members\":[]}"));
        var result = mock(TenantNodeModels.CommandResult.class);
        when(result.data()).thenReturn(mapper.readTree("{\"messageId\":\"90\",\"recalled\":true,\"content\":\"张三 撤回了一条消息\",\"recall\":{\"operatorId\":\"77\",\"operatorName\":\"张三\",\"recalledAt\":1000}}"));
        when(data.write(eq(tenant), eq("POST"), eq("/messages/90/recall"), eq("30"), eq("RECALL_MESSAGE"), any())).thenReturn(result);
        var response = (JSONObject) service.change(tenant, "recall", 30L, new Object[]{30L, 90L});
        assertThat(response.getString("content")).isEqualTo("张三 撤回了一条消息");
        assertThat(response.getJSONObject("recall").getString("operatorName")).isEqualTo("张三");
        verify(events).publishTenantMembers(eq(tenant), eq(response), anyList());
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"leave", "remove"})
    void membershipDepartureBroadcastsThePersistedNoticeToThePreChangeMembers(String method) throws Exception {
        var mapper = new ObjectMapper();
        var data = mock(TenantGroupData.class);
        var events = mock(GroupChatEventPublisher.class);
        var service = new TenantGroupManagementService(data, mapper, events,
            mock(TenantGroupTaskStopService.class), mock(com.iwhalecloud.byai.manager.mapper.tenant.TenantMembershipMapper.class));
        var tenant = new TenantRequestContext(77L, 10L, "MEMBER");
        when(data.read(eq(tenant), anyString())).thenReturn(mapper.readTree("{\"members\":[{\"memObjType\":\"USER\",\"memObjId\":\"77\"}]}"));
        var result = mock(TenantNodeModels.CommandResult.class);
        when(result.data()).thenReturn(mapper.readTree("{\"systemEvents\":[{\"type\":\"GROUP_CHAT_EVENT\",\"event\":\"MESSAGE_CREATED\",\"sessionId\":\"30\",\"messageId\":\"90\",\"kind\":\"SYSTEM_EVENT\"}]}"));
        when(data.write(eq(tenant), anyString(), anyString(), eq("30"), anyString(), any())).thenReturn(result);
        assertThat(service.change(tenant, method, 30L, new Object[]{30L, "USER", 77L})).isNull();
        var notices = org.mockito.ArgumentCaptor.forClass(JSONObject.class);
        var recipients = org.mockito.ArgumentCaptor.forClass(java.util.List.class);
        verify(events, times(2)).publishTenantMembers(eq(tenant), notices.capture(), recipients.capture());
        assertThat(notices.getAllValues()).extracting(value -> value.getString("event"))
            .containsExactly("MEMBER_REMOVED", "MESSAGE_CREATED");
        assertThat(recipients.getValue()).hasSize(1);
        verify(events, never()).publishTenant(any(), any(), any());
    }
}
