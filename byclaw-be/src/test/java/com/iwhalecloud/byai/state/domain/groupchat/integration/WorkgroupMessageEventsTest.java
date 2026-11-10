package com.iwhalecloud.byai.state.domain.groupchat.integration;

import java.util.List;
import java.util.Map;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.hook.HookPublisher;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.hook.WorkgroupMessageEvents;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

class WorkgroupMessageEventsTest {
    @Test
    void factsContainOnlyIdentifiersAndNeverDeviceOrMessageContent() {
        HookPublisher publisher = mock(HookPublisher.class);
        var events = new WorkgroupMessageEvents(publisher);
        var event = new JSONObject();
        event.putAll(Map.of("event", "MESSAGE_CREATED", "sessionId", "30", "messageId", "9007199254740993",
            "creatorId", "22", "speaker", Map.of("type", "USER"), "content", "private", "token", "private"));
        events.committed(7, event, List.of(22L, 23L, 23L));
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> data = ArgumentCaptor.forClass(Map.class);
        verify(publisher).publishCommitted(eq("workgroup.message.created"), eq(1), data.capture());
        assertThat(data.getValue()).containsEntry("messageId", "9007199254740993")
            .containsEntry("recipientIds", List.of("22", "23"))
            .containsEntry("senderType", "USER").doesNotContainKeys("content", "token", "devices");
        event.put("messageId", "40");
        assertThat(data.getValue()).containsEntry("messageId", "9007199254740993");
    }

    @Test
    void nonFinalEventsAndOversizedIdentifiersNeverPublish() {
        HookPublisher publisher = mock(HookPublisher.class);
        var events = new WorkgroupMessageEvents(publisher);
        events.committed(7, new JSONObject(Map.of("event", "AGENT_STREAM")), List.of(22L));
        events.committed(7, new JSONObject(Map.of("event", "MESSAGE_CREATED", "sessionId", "30",
            "messageId", "9999999999999999999")), List.of(22L));
        verifyNoInteractions(publisher);
    }
}
