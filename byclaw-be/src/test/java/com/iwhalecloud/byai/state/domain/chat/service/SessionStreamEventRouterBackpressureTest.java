package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.chat.enums.ChatTransport;
import com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService;

class SessionStreamEventRouterBackpressureTest {

    private OutputStreamManager outputStreamManager;
    private SessionStreamEventRouter router;

    @BeforeEach
    void setUp() {
        router = new SessionStreamEventRouter();
        outputStreamManager = mock(OutputStreamManager.class);
        GatewayStreamEventProcessor eventProcessor = mock(GatewayStreamEventProcessor.class);
        ReflectionTestUtils.setField(router, "outputStreamManager", outputStreamManager);
        ReflectionTestUtils.setField(router, "multiDeviceBroadcastService", mock(MultiDeviceBroadcastService.class));
        ReflectionTestUtils.setField(router, "gatewayStreamEventProcessor", eventProcessor);
        ReflectionTestUtils.setField(router, "chatContextRecoveryService", mock(ChatContextRecoveryService.class));
        ReflectionTestUtils.setField(router, "cronService", mock(CronService.class));
        when(eventProcessor.buildEventData(any(), any(), any())).thenReturn("{}");
    }

    @AfterEach
    void clearInterruptFlag() {
        Thread.interrupted();
    }

    @Test
    void waitsForHttpQueueCapacityInsteadOfDroppingEvent() throws Exception {
        SignallingQueue queue = new SignallingQueue(1);
        queue.add(event("existing"));
        ChatProcessContext ctx = httpContext(queue);
        JSONObject next = event("next");

        CompletableFuture<StreamDispatchResult> dispatch = CompletableFuture.supplyAsync(() -> router.dispatch(next));

        assertThat(queue.awaitPut()).as("事件路由应进入阻塞式背压，而不是在队列满时静默丢弃").isTrue();
        assertThat(dispatch.isDone()).isFalse();
        queue.take();

        assertThat(dispatch.get(1, TimeUnit.SECONDS)).isSameAs(StreamDispatchResult.HANDLED);
        assertThat(queue.take()).isSameAs(next);
        assertThat(ctx.gatewayEventQueue).isEmpty();
    }

    @Test
    void keepsRecordPendingWhenBackpressureWaitIsInterrupted() {
        ChatProcessContext ctx = httpContext(new InterruptingQueue());

        StreamDispatchResult result = router.dispatch(event("next"));

        assertThat(result.shouldAcknowledge()).isFalse();
        assertThat(Thread.currentThread().isInterrupted()).isTrue();
        assertThat(ctx.gatewayEventQueue).isEmpty();
    }

    private ChatProcessContext httpContext(ArrayBlockingQueue<JSONObject> queue) {
        ChatProcessContext ctx = new ChatProcessContext(null, null);
        ctx.sessionId = 10L;
        ctx.transport = ChatTransport.HTTP_SSE;
        ctx.gatewayEventQueue = queue;
        when(outputStreamManager.getContext("10")).thenReturn(ctx);
        return ctx;
    }

    private JSONObject event(String value) {
        JSONObject event = new JSONObject();
        event.put("session_id", "10");
        event.put("event_type", "answerDelta");
        event.put("value", value);
        return event;
    }

    private static class SignallingQueue extends ArrayBlockingQueue<JSONObject> {

        private final CountDownLatch putEntered = new CountDownLatch(1);

        SignallingQueue(int capacity) {
            super(capacity);
        }

        @Override
        public void put(JSONObject event) throws InterruptedException {
            putEntered.countDown();
            super.put(event);
        }

        boolean awaitPut() throws InterruptedException {
            return putEntered.await(1, TimeUnit.SECONDS);
        }
    }

    private static final class InterruptingQueue extends ArrayBlockingQueue<JSONObject> {

        InterruptingQueue() {
            super(1);
        }

        @Override
        public void put(JSONObject event) throws InterruptedException {
            throw new InterruptedException("stop");
        }
    }
}
