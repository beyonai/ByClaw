package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.when;

import java.util.List;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.session.service.SessionExtService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.springframework.transaction.PlatformTransactionManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

@ExtendWith(MockitoExtension.class)
class SessionStreamEventRouterScopedSessionTest {

    @Mock
    private ScopedSessionEventService scopedSessionEventService;

    @Mock
    private SessionRuntimeStateService sessionRuntimeStateService;

    private RuntimeException missingParent;

    @BeforeEach
    void buildMissingParentFailure() {
        ExternalChildSessionService bindings = new ExternalChildSessionService(
            mock(SessionService.class), mock(SessionExtService.class), mock(SequenceService.class),
            mock(PlatformTransactionManager.class));
        missingParent = catchThrowableOfType(
            () -> bindings.ensureBinding(100L, childEvent(0L).getJSONObject("metadata")), RuntimeException.class);
        assertThat(missingParent).isInstanceOf(ExternalChildSessionService.MissingParentSessionException.class);
    }

    @Test
    void oldChildEventWithMissingParentIsAcknowledgedInsteadOfRetriedForever() {
        SessionStreamEventRouter router = router();
        JSONObject event = childEvent(System.currentTimeMillis() - 600_000L);
        when(scopedSessionEventService.handleIfNecessary(100L, event)).thenThrow(missingParent);

        StreamDispatchResult result = router.dispatch(event);

        assertThat(result).isEqualTo(StreamDispatchResult.INTENTIONALLY_IGNORED);
        assertThat(result.shouldAcknowledge()).isTrue();
        assertThat(result.isRetryable()).isFalse();
    }

    @Test
    void oldChildBatchWithMissingParentIsAcknowledged() {
        SessionStreamEventRouter router = router();
        var events = List.of(childEvent(System.currentTimeMillis() - 600_000L));
        doThrow(missingParent).when(scopedSessionEventService).handleChildBatch(100L, events);

        assertThat(router.dispatchChildBatch(100L, events)).isEqualTo(StreamDispatchResult.INTENTIONALLY_IGNORED);
    }

    @Test
    void freshMissingParentIsRetriedToAllowItsTransactionToCommit() {
        SessionStreamEventRouter router = router();
        JSONObject event = childEvent(System.currentTimeMillis());
        when(scopedSessionEventService.handleIfNecessary(100L, event)).thenThrow(missingParent);

        assertThat(router.dispatch(event)).isEqualTo(StreamDispatchResult.ERROR);
    }

    @Test
    void mixedAgeBatchKeepsAllEventsPending() {
        SessionStreamEventRouter router = router();
        var events = List.of(childEvent(System.currentTimeMillis() - 600_000L),
            childEvent(System.currentTimeMillis()));
        doThrow(missingParent).when(scopedSessionEventService).handleChildBatch(100L, events);

        assertThat(router.dispatchChildBatch(100L, events)).isEqualTo(StreamDispatchResult.ERROR);
    }

    @Test
    void missingStreamAgeAndUnrelatedFailuresRemainRetryable() {
        SessionStreamEventRouter router = router();
        JSONObject unknownAge = childEvent(System.currentTimeMillis());
        unknownAge.remove("stream_id");
        when(scopedSessionEventService.handleIfNecessary(100L, unknownAge)).thenThrow(missingParent);
        assertThat(router.dispatch(unknownAge)).isEqualTo(StreamDispatchResult.ERROR);

        JSONObject oldEvent = childEvent(System.currentTimeMillis() - 600_000L);
        when(scopedSessionEventService.handleIfNecessary(100L, oldEvent))
            .thenThrow(new IllegalArgumentException("invalid metadata"));
        assertThat(router.dispatch(oldEvent)).isEqualTo(StreamDispatchResult.ERROR);
    }

    @Test
    void futureOrMalformedStreamIdsCannotExpireAnEvent() {
        SessionStreamEventRouter router = router();
        for (String streamId : List.of("bad-id", "0-0", "-1-0", (System.currentTimeMillis() + 600_000L) + "-0")) {
            JSONObject event = childEvent(0L);
            event.put("stream_id", streamId);
            when(scopedSessionEventService.handleIfNecessary(100L, event)).thenThrow(missingParent);
            assertThat(router.dispatch(event)).isEqualTo(StreamDispatchResult.ERROR);
        }
    }

    @Test
    void oldEventsAreNotAcknowledgedWhenDatabaseAccessFails() {
        SessionStreamEventRouter router = router();
        JSONObject event = childEvent(System.currentTimeMillis() - 600_000L);
        when(scopedSessionEventService.handleIfNecessary(100L, event))
            .thenThrow(new org.springframework.dao.DataAccessResourceFailureException("database unavailable"));
        assertThat(router.dispatch(event).shouldAcknowledge()).isFalse();
    }

    private SessionStreamEventRouter router() {
        SessionStreamEventRouter router = new SessionStreamEventRouter();
        ReflectionTestUtils.setField(router, "scopedSessionEventService", scopedSessionEventService);
        return router;
    }

    private JSONObject childEvent(long created) {
        JSONObject event = new JSONObject();
        event.put("session_id", "100");
        event.put("event_type", "answerDelta");
        event.put("stream_id", created + "-0");
        JSONObject metadata = new JSONObject();
        metadata.put("session_scope", "child");
        metadata.put("external_session_id", "child-100");
        event.put("metadata", metadata);
        return event;
    }

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

    @Test
    void dispatchStopsAfterAParentRuntimeEventWasApplied() {
        SessionStreamEventRouter router = new SessionStreamEventRouter();
        ReflectionTestUtils.setField(router, "scopedSessionEventService", scopedSessionEventService);
        ReflectionTestUtils.setField(router, "sessionRuntimeStateService", sessionRuntimeStateService);
        JSONObject event = new JSONObject();
        event.put("session_id", "100");
        JSONObject metadata = new JSONObject();
        metadata.put("event_source", "integration-a");
        metadata.put("event_kind", "session.runtime");
        metadata.put("session_scope", "parent");
        event.put("metadata", metadata);
        when(sessionRuntimeStateService.isRuntimeEvent(event)).thenReturn(true);

        StreamDispatchResult result = router.dispatch(event);

        assertThat(result).isEqualTo(StreamDispatchResult.HANDLED);
        verify(sessionRuntimeStateService).applyEvent(100L, event);
        verify(scopedSessionEventService, never()).handleIfNecessary(100L, event);
    }
}
