package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatInfo;

class ChatStreamRuntimeCoordinatorBackpressureTest {

    @Test
    void createsBoundedHttpEventQueueFromConfiguredCapacity() {
        ChatStreamRuntimeCoordinator coordinator = new ChatStreamRuntimeCoordinator();
        OutputStreamManager outputStreamManager = new OutputStreamManager();
        SessionStreamManager sessionStreamManager = mock(SessionStreamManager.class);
        RunningOutputStreamRegistry runningOutputStreamRegistry = mock(RunningOutputStreamRegistry.class);
        RunningChatInfo runningChatInfo = new RunningChatInfo();
        runningChatInfo.setRunning(false);

        ReflectionTestUtils.setField(coordinator, "outputStreamManager", outputStreamManager);
        ReflectionTestUtils.setField(coordinator, "sessionStreamManager", sessionStreamManager);
        ReflectionTestUtils.setField(coordinator, "runningOutputStreamRegistry", runningOutputStreamRegistry);
        ReflectionTestUtils.setField(coordinator, "gatewayEventQueueCapacity", 2);
        when(runningOutputStreamRegistry.getRunning(10L)).thenReturn(runningChatInfo);
        when(sessionStreamManager.startSessionListener(eq("10"), any())).thenReturn(true);

        ChatProcessContext ctx = new ChatProcessContext(null, null);
        ctx.sessionId = 10L;

        assertThat(coordinator.startIfNecessary(ctx)).isTrue();
        assertThat(ctx.gatewayEventQueue.remainingCapacity()).isEqualTo(2);
    }
}
