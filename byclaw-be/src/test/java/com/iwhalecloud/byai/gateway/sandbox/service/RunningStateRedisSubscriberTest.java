package com.iwhalecloud.byai.gateway.sandbox.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RunningStateRedisSubscriberTest {

    @Test
    void handleMessage_refreshesOpenclawSandboxWhenByclawExeSnapshotIsBusy() {
        SandboxService sandboxService = mock(SandboxService.class);
        RunningStateRedisSubscriber subscriber = newSubscriber(sandboxService);
        when(sandboxService.heartbeatOpenclawSandbox("user001")).thenReturn(true);

        boolean result = subscriber.handleMessage(message("BYCLAW_EXE_user001", "user001", true));

        assertThat(result).isTrue();
        verify(sandboxService).heartbeatOpenclawSandbox("user001");
    }

    @Test
    void handleMessage_acceptsBaseByclawExeAgentType() {
        SandboxService sandboxService = mock(SandboxService.class);
        RunningStateRedisSubscriber subscriber = newSubscriber(sandboxService);
        when(sandboxService.heartbeatOpenclawSandbox("user001")).thenReturn(true);

        boolean result = subscriber.handleMessage(message("BYCLAW_EXE", "user001", true));

        assertThat(result).isTrue();
        verify(sandboxService).heartbeatOpenclawSandbox("user001");
    }

    @Test
    void handleMessage_ignoresIdleSnapshot() {
        SandboxService sandboxService = mock(SandboxService.class);
        RunningStateRedisSubscriber subscriber = newSubscriber(sandboxService);

        boolean result = subscriber.handleMessage(message("BYCLAW_EXE_user001", "user001", false));

        assertThat(result).isFalse();
        verify(sandboxService, never()).heartbeatOpenclawSandbox("user001");
    }

    @Test
    void handleMessage_ignoresNonByclawExeAgentType() {
        SandboxService sandboxService = mock(SandboxService.class);
        RunningStateRedisSubscriber subscriber = newSubscriber(sandboxService);

        boolean result = subscriber.handleMessage(message("BYCLAW_DATA_user001", "user001", true));

        assertThat(result).isFalse();
        verify(sandboxService, never()).heartbeatOpenclawSandbox("user001");
    }

    @Test
    void handleMessage_ignoresUnsupportedEnvelope() {
        SandboxService sandboxService = mock(SandboxService.class);
        RunningStateRedisSubscriber subscriber = newSubscriber(sandboxService);

        boolean result = subscriber.handleMessage("""
            {
              "schema": "unknown",
              "schemaVersion": 1,
              "agentType": "BYCLAW_EXE_user001",
              "userCode": "user001",
              "payload": {
                "marker": "openclaw-busy-state",
                "version": 1,
                "event": "snapshot",
                "busy": true
              }
            }
            """);

        assertThat(result).isFalse();
        verify(sandboxService, never()).heartbeatOpenclawSandbox("user001");
    }

    private RunningStateRedisSubscriber newSubscriber(SandboxService sandboxService) {
        return new RunningStateRedisSubscriber(
            mock(RedisMessageListenerContainer.class),
            sandboxService,
            new ObjectMapper(),
            RunningStateRedisSubscriber.DEFAULT_TOPIC);
    }

    private String message(String agentType, String userCode, boolean busy) {
        return """
            {
              "schema": "openclaw.busy_state.redis_stats",
              "schemaVersion": 1,
              "topic": "byai_gateway:registry:worker:stats:openclaw",
              "agentType": "%s",
              "userCode": "%s",
              "emittedAt": "2026-06-01T00:00:00.000Z",
              "payload": {
                "marker": "openclaw-busy-state",
                "version": 1,
                "event": "snapshot",
                "busy": %s
              }
            }
            """.formatted(agentType, userCode, busy);
    }
}
