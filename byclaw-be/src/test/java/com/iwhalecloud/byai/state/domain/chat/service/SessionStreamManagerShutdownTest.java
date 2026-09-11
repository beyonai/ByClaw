package com.iwhalecloud.byai.state.domain.chat.service;

import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.when;

import java.util.Map;

import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.context.event.ContextClosedEvent;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.state.domain.ws.handler.RedisStreamMessageListener;

/** 验证优雅关闭先停止消费，再标记运行态可交接，最后释放跨 Pod listener lease。 */
class SessionStreamManagerShutdownTest {

    @Test
    @SuppressWarnings({"unchecked", "rawtypes"})
    void marksOwnedRuntimeForHandoffBeforeReleasingListenerLease() {
        SessionStreamManager manager = new SessionStreamManager();
        SessionStreamMetrics metrics = mock(SessionStreamMetrics.class);
        OutputStreamManager outputStreamManager = spy(new OutputStreamManager());
        ChatRuntimeStateService runtimeStateService = mock(ChatRuntimeStateService.class);
        SessionStreamLeaseService leaseService = mock(SessionStreamLeaseService.class);
        ReactiveSessionStreamReceiver receiver = mock(ReactiveSessionStreamReceiver.class);
        RedisStreamMessageListener listener = mock(RedisStreamMessageListener.class);
        SessionStreamLeaseService.Lease lease = new SessionStreamLeaseService.Lease("10", "lease-token");
        ChatProcessContext ctx = new ChatProcessContext(null, null);
        ctx.sessionId = 10L;
        ctx.runningOutputStreamToken = "runtime-token";

        ReflectionTestUtils.setField(manager, "sessionStreamMetrics", metrics);
        ReflectionTestUtils.setField(manager, "outputStreamManager", outputStreamManager);
        ReflectionTestUtils.setField(manager, "chatRuntimeStateService", runtimeStateService);
        ReflectionTestUtils.setField(manager, "sessionStreamLeaseService", leaseService);
        ReflectionTestUtils.setField(manager, "reactiveSessionStreamReceiver", receiver);
        ((Map<String, RedisStreamMessageListener>) ReflectionTestUtils.getField(manager, "listeners"))
            .put("10", listener);
        ((Map<String, SessionStreamLeaseService.Lease>) ReflectionTestUtils.getField(manager, "streamLeases"))
            .put("10", lease);
        when(outputStreamManager.getContexts("10")).thenReturn(java.util.List.of(ctx));
        when(runtimeStateService.requestHandoff(ctx)).thenReturn(true);

        manager.onApplicationEvent(mock(ContextClosedEvent.class));

        InOrder shutdownOrder = inOrder(receiver, runtimeStateService, leaseService);
        shutdownOrder.verify(receiver).unregister("10");
        shutdownOrder.verify(runtimeStateService).requestHandoff(ctx);
        shutdownOrder.verify(leaseService).release(lease);
    }
}
