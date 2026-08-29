package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson.JSONObject;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

@ExtendWith(MockitoExtension.class)
class SessionStreamEventRouterScopedSessionTest {

    @Mock
    private ScopedSessionEventService scopedSessionEventService;

    @Test
    void dispatchStopsAfterAChildScopedEventWasPersisted() {
        SessionStreamEventRouter router = new SessionStreamEventRouter();
        ReflectionTestUtils.setField(router, "scopedSessionEventService", scopedSessionEventService);
        JSONObject event = new JSONObject();
        event.put("session_id", "100");
        event.put("event_type", "answerDelta");
        JSONObject metadata = new JSONObject();
        metadata.put("session_scope", "child");
        event.put("metadata", metadata);
        when(scopedSessionEventService.handleIfNecessary(100L, event)).thenReturn(true);

        StreamDispatchResult result = router.dispatch(event);

        assertThat(result).isEqualTo(StreamDispatchResult.HANDLED);
        verify(scopedSessionEventService).handleIfNecessary(100L, event);
    }
}
