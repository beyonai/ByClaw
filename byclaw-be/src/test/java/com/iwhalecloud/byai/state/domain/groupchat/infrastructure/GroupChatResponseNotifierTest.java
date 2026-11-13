package com.iwhalecloud.byai.state.domain.groupchat.infrastructure;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatResponseQueryService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

/** 私有运行绑定不得进入群广播；创建者 Codex，2026-11-13。 */
class GroupChatResponseNotifierTest {
    @Test
    void removesInitiatorStreamFromPublicEvent() {
        var query = mock(GroupChatResponseQueryService.class);
        var publisher = mock(GroupChatEventPublisher.class);
        var notifier = new GroupChatResponseNotifier();
        ReflectionTestUtils.setField(notifier, "queryService", query);
        ReflectionTestUtils.setField(notifier, "eventPublisher", publisher);
        when(query.resolveFor(30L, List.of("turn:60"), 20L, null)).thenReturn(JSON.parseObject(
            "{\"items\":[{\"responseId\":\"turn:60\",\"canReadContent\":true,"
                + "\"stream\":{\"traceId\":\"private\",\"text\":\"private answer\"}}]}"));
        notifier.changed(30L, "turn:60", 20L, null);
        var event = ArgumentCaptor.forClass(JSONObject.class);
        verify(publisher).publish(eq(30L), event.capture(), isNull());
        assertFalse(event.getValue().containsKey("stream"));
        assertFalse(event.getValue().containsKey("canReadContent"));
        assertFalse(event.getValue().toJSONString().contains("private"));
    }
}
