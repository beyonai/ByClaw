package com.iwhalecloud.byai.manager.domain.tenant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson.JSONObject;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatPendingPublicationRequest;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

class TenantGroupTaskPreparationTest {
    @Test
    void committedPendingCardNotifiesOnlyTheInitiatorInItsTenant() throws Exception {
        var mapper = new ObjectMapper();
        var data = mock(TenantGroupData.class);
        var publicEvents = mock(GroupChatEventPublisher.class);
        var broadcaster = mock(MultiDeviceBroadcastService.class);
        var service = new TenantGroupTaskService(data, mapper, mock(TenantGroupTaskStopService.class), publicEvents);
        ReflectionTestUtils.setField(service, "broadcaster", broadcaster);
        var tenant = new TenantRequestContext(57L, 11237409L, "MEMBER");
        Long taskId = 8011237409000004638L;
        when(data.read(tenant, "group-chat/tasks/" + taskId))
            .thenReturn(mapper.readTree("{\"groupSessionId\":\"2108809138493460480\"}"));
        var pending = mapper.readTree("{\"taskId\":\"8011237409000004638\",\"pendingPublicationId\":\"78\"}");
        when(data.read(tenant, "group-chat/tasks/" + taskId + "/pending-publication")).thenReturn(pending);
        var request = new GroupChatPendingPublicationRequest(); request.setText("member introductions");
        assertThat(service.prepare(tenant, taskId, request)).isSameAs(pending);
        var event = ArgumentCaptor.forClass(JSONObject.class);
        var order = inOrder(data, broadcaster);
        order.verify(data).read(tenant, "group-chat/tasks/" + taskId);
        order.verify(data).write(eq(tenant), eq("POST"), eq("/tasks/" + taskId + "/pending-publication"),
            eq("2108809138493460480"), eq("SAVE_PENDING_PUBLICATION"), any());
        order.verify(data).read(tenant, "group-chat/tasks/" + taskId + "/pending-publication");
        order.verify(broadcaster).broadcastTenantRawToUser(eq(tenant), event.capture(), isNull());
        assertThat(event.getValue().getString("type")).isEqualTo("GROUP_CHAT_TASK_EVENT");
        assertThat(event.getValue().getString("event")).isEqualTo("TASK_PUBLICATION_PREPARED");
        assertThat(event.getValue().get("taskId")).isEqualTo(taskId.toString());
        assertThat(event.getValue().get("pendingPublicationId")).isEqualTo("78");
        verifyNoInteractions(publicEvents);
    }
}
