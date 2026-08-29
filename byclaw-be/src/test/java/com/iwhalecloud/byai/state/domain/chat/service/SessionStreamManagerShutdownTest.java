package com.iwhalecloud.byai.state.domain.chat.service;

import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.Map;

import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.context.event.ContextClosedEvent;
import org.springframework.data.redis.stream.StreamMessageListenerContainer;
import org.springframework.test.util.ReflectionTestUtils;

/** 验证优雅关闭先停止消费，再标记运行态可交接，最后释放跨 Pod listener lease。 */
class SessionStreamManagerShutdownTest {

    @Test
    @SuppressWarnings({"unchecked", "rawtypes"})
    void marksOwnedRuntimeForHandoffBeforeReleasingListenerLease() {
        SessionStreamManager manager = new SessionStreamManager();
        SessionStreamMetrics metrics = mock(SessionStreamMetrics.class);
        OutputStreamManager outputStreamManager = mock(OutputStreamManager.class);
        ChatRuntimeStateService runtimeStateService = mock(ChatRuntimeStateService.class);
        SessionStreamLeaseService leaseService = mock(SessionStreamLeaseService.class);
        StreamMessageListenerContainer container = mock(StreamMessageListenerContainer.class);
        SessionStreamLeaseService.Lease lease = new SessionStreamLeaseService.Lease("10", "lease-token");
        ChatProcessContext ctx = new ChatProcessContext(null, null);
        ctx.sessionId = 10L;
        ctx.runningOutputStreamToken = "runtime-token";

        ReflectionTestUtils.setField(manager, "sessionStreamMetrics", metrics);
        ReflectionTestUtils.setField(manager, "outputStreamManager", outputStreamManager);
        ReflectionTestUtils.setField(manager, "chatRuntimeStateService", runtimeStateService);
        ReflectionTestUtils.setField(manager, "sessionStreamLeaseService", leaseService);
        ((Map<String, StreamMessageListenerContainer>) ReflectionTestUtils.getField(manager, "containers"))
            .put("10", container);
        ((Map<String, SessionStreamLeaseService.Lease>) ReflectionTestUtils.getField(manager, "streamLeases"))
            .put("10", lease);
        when(outputStreamManager.getContext("10")).thenReturn(ctx);
        when(runtimeStateService.requestHandoff(ctx)).thenReturn(true);

        manager.onApplicationEvent(mock(ContextClosedEvent.class));

        InOrder shutdownOrder = inOrder(container, runtimeStateService, leaseService);
        shutdownOrder.verify(container).stop();
        shutdownOrder.verify(runtimeStateService).requestHandoff(ctx);
        shutdownOrder.verify(leaseService).release(lease);
    }
}
