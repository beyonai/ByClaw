package com.iwhalecloud.byai.gateway.sandbox.service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.data.redis.listener.ChannelTopic;
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

    @Test
    void subscribesAndUnsubscribesBothRuntimeFamilies() {
        RedisMessageListenerContainer container = mock(RedisMessageListenerContainer.class);
        RunningStateRedisSubscriber subscriber = new RunningStateRedisSubscriber(container,
            mock(SandboxService.class), new ObjectMapper(), RunningStateRedisSubscriber.DEFAULT_TOPIC);

        subscriber.start();
        verify(container).addMessageListener(subscriber,
            new ChannelTopic("byai_gateway:registry:worker:stats:openclaw"));
        verify(container).addMessageListener(subscriber,
            new ChannelTopic("byai_gateway:registry:worker:stats:dsh"));
        subscriber.stop();
        verify(container).removeMessageListener(subscriber,
            new ChannelTopic("byai_gateway:registry:worker:stats:openclaw"));
        verify(container).removeMessageListener(subscriber,
            new ChannelTopic("byai_gateway:registry:worker:stats:dsh"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"BYCLAW_DSH", "BYCLAW_DSH_user001"})
    void parentIdleWithBusyAgentTeamChildRefreshesOnlyDshSandbox(String agentType) {
        RecordingDshSandboxService service = new RecordingDshSandboxService();
        RunningStateRedisSubscriber subscriber = newSubscriber(service);

        assertThat(subscriber.handleMessage(dshMessage(agentType, true, Instant.now()))).isTrue();
        assertThat(service.refreshedUsers).containsExactly("user001");
    }

    @Test
    void idleDshSnapshotDoesNotRefreshSandbox() {
        RecordingDshSandboxService service = new RecordingDshSandboxService();
        assertThat(newSubscriber(service).handleMessage(dshMessage("BYCLAW_DSH_user001", false, Instant.now())))
            .isFalse();
        assertThat(service.refreshedUsers).isEmpty();
    }

    @Test
    void mismatchedSchemaMarkerOrAgentFamilyNeverRefreshesAnotherSandboxType() {
        RecordingDshSandboxService service = new RecordingDshSandboxService();
        RunningStateRedisSubscriber subscriber = newSubscriber(service);
        String dsh = dshMessage("BYCLAW_DSH_user001", true, Instant.now());

        assertThat(subscriber.handleMessage(dsh.replace("BYCLAW_DSH_user001", "BYCLAW_EXE_user001"))).isFalse();
        assertThat(subscriber.handleMessage(message("BYCLAW_DSH_user001", "user001", true))).isFalse();
        assertThat(subscriber.handleMessage(dsh.replace("byclaw-dsh-busy-state", "openclaw-busy-state"))).isFalse();
        assertThat(service.refreshedUsers).isEmpty();
    }

    @Test
    void staleOrFutureDshSnapshotsCannotExtendSandboxLifetime() {
        RecordingDshSandboxService service = new RecordingDshSandboxService();
        RunningStateRedisSubscriber subscriber = newSubscriber(service);

        assertThat(subscriber.handleMessage(dshMessage("BYCLAW_DSH_user001", true, Instant.now().minusSeconds(300))))
            .isFalse();
        assertThat(subscriber.handleMessage(dshMessage("BYCLAW_DSH_user001", true, Instant.now().plusSeconds(300))))
            .isFalse();
        assertThat(subscriber.handleMessage(dshMessage("BYCLAW_DSH_user001", true, Instant.now())
            .replace("\"generatedAt\"", "\"missingGeneratedAt\""))).isFalse();
        assertThat(service.refreshedUsers).isEmpty();
    }

    static String dshMessage(String agentType, boolean busy, Instant generatedAt) {
        return """
            {
              "schema": "byclaw_dsh.busy_state.redis_stats",
              "schemaVersion": 1,
              "topic": "byai_gateway:registry:worker:stats:dsh",
              "agentType": "%s",
              "userCode": "user001",
              "emittedAt": "%s",
              "payload": {
                "marker": "byclaw-dsh-busy-state",
                "version": 1,
                "event": "snapshot",
                "busy": %s,
                "generatedAt": "%s",
                "activeRuns": 0,
                "agentTeams": {"running": 1}
              }
            }
            """.formatted(agentType, generatedAt, busy, generatedAt);
    }

    private static final class RecordingDshSandboxService extends SandboxService {
        private final List<String> refreshedUsers = new ArrayList<>();

        @Override
        public boolean heartbeatDshSandbox(String userCode) {
            refreshedUsers.add(userCode);
            return true;
        }

        @Override
        public boolean heartbeatOpenclawSandbox(String userCode) {
            throw new AssertionError("A DSH event must never refresh an OpenClaw sandbox");
        }
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
