package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.state.common.enums.AgentTypeEnum;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.enums.ChatUseageEnum;
import com.iwhalecloud.byai.state.domain.chat.model.ExternalChildSessionBinding;
import com.iwhalecloud.byai.state.domain.chat.model.MessageContext;
import com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto;
import com.iwhalecloud.byai.state.domain.message.service.MemoryMessageService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class ScopedSessionEventServiceTest {

    @Mock
    private ExternalChildSessionService childSessionService;

    @Mock
    private GatewayStreamEventProcessor gatewayStreamEventProcessor;

    @Mock
    private PythonSseService pythonSseService;

    @Mock
    private MemoryMessageService memoryMessageService;

    @Mock
    private ScopedProjectionBroadcaster projectionBroadcaster;

    @Mock
    private RunningChatSnapshotService runningChatSnapshotService;

    @Mock
    private ScopedMessageWriteBehind childMessageWriteBehind;

    private ScopedSessionEventService service;

    @BeforeEach
    void setUp() {
        service = new ScopedSessionEventService(childSessionService, gatewayStreamEventProcessor, pythonSseService,
            memoryMessageService, projectionBroadcaster, runningChatSnapshotService, childMessageWriteBehind);
    }

    @Test
    void childEventIsPersistedInItsOwnConversationAndNotRoutedIntoParent() {
        JSONObject metadata = childMetadata("worker-child-1", "架构舵手", "架构负责人");
        JSONObject event = streamEvent("answerDelta", "子 Agent 的最终结论", metadata);
        ByaiSession child = childSession(200L, 100L, 900L);
        when(childSessionService.ensureBinding(100L, metadata))
            .thenReturn(new ExternalChildSessionBinding(child, "worker-child-1", 201L));
        when(gatewayStreamEventProcessor.buildEventData(any(ChatProcessContext.class), eq(event), eq(metadata)))
            .thenReturn(event.getString("data"));
        ByaiMessageHotDtoDto persisted = new ByaiMessageHotDtoDto();
        persisted.setMessageId(201L);
        persisted.setSessionId(200L);
        persisted.setCreatorId(900L);
        when(memoryMessageService.generateMessage(eq(200L), eq(ChatUseageEnum.SYSTEM_RESPONSE.getCode()),
            any(MessageContext.class), any(AssistantChatDto.class))).thenReturn(persisted);
        when(runningChatSnapshotService.saveExternalChild(persisted, "1-0", true)).thenReturn(true);

        assertThat(service.handleIfNecessary(100L, event)).isTrue();

        ArgumentCaptor<MessageContext> contextCaptor = ArgumentCaptor.forClass(MessageContext.class);
        verify(pythonSseService).accumulateEvent(any(String.class), contextCaptor.capture());
        assertThat(contextCaptor.getValue().getMessageId()).isEqualTo(201L);
        assertThat(contextCaptor.getValue().getType()).isEqualTo(AgentTypeEnum.AGENT);
        verify(runningChatSnapshotService).saveExternalChild(persisted, "1-0", true);
        verify(childMessageWriteBehind).enqueue("child:200:201", 200L, persisted, true);
        verify(projectionBroadcaster).enqueue(eq("100:worker-child-1"), eq(900L), any(JSONObject.class), eq(true));
    }

    @Test
    void teamSnapshotIsEnrichedWithNavigableByClawChildSessionIds() {
        JSONObject metadata = new JSONObject();
        metadata.put("session_scope", "team");
        metadata.put("external_session_id", "worker-root-1");
        metadata.put("external_root_session_id", "worker-root-1");
        metadata.put("event_source", "test-worker");
        metadata.put("team_id", "team-1");

        JSONObject member = new JSONObject();
        member.put("id", "worker-child-1");
        member.put("name", "架构舵手");
        member.put("role", "架构负责人");
        member.put("status", "active");
        member.put("currentTask", "分析父子会话架构");
        JSONObject team = new JSONObject();
        team.put("teamId", "team-1");
        team.put("members", new JSONArray().fluentAdd(member));
        JSONObject card = new JSONObject();
        card.put("schemaVersion", 2);
        card.put("eventKind", "agent-teams/snapshot");
        card.put("team", team);
        JSONObject event = streamEvent("reasoningLogDelta", card.toJSONString(), metadata);

        ByaiSession child = childSession(200L, 100L, 900L);
        when(childSessionService.ensureBinding(eq(100L), any(JSONObject.class)))
            .thenReturn(new ExternalChildSessionBinding(child, "worker-child-1", 201L));

        assertThat(service.handleIfNecessary(100L, event)).isFalse();

        JSONObject enrichedDelta = JSON.parseObject(event.getString("data"));
        JSONObject enrichedCard = JSON.parseObject(
            enrichedDelta.getJSONArray("choices").getJSONObject(0).getJSONObject("delta").getString("content"));
        JSONObject enrichedMember = enrichedCard.getJSONObject("team").getJSONArray("members").getJSONObject(0);
        assertThat(enrichedMember.getString("byclawSessionId")).isEqualTo("200");

        ArgumentCaptor<JSONObject> childMetadata = ArgumentCaptor.forClass(JSONObject.class);
        verify(childSessionService).ensureBinding(eq(100L), childMetadata.capture());
        assertThat(childMetadata.getValue().getString("session_scope")).isEqualTo("child");
        assertThat(childMetadata.getValue().getString("child_name")).isEqualTo("架构舵手");
        assertThat(childMetadata.getValue().getString("child_role")).isEqualTo("架构负责人");
        assertThat(metadata.getString("session_scope")).isEqualTo("team");
        assertThat(metadata.getString("external_session_id")).isEqualTo("worker-root-1");
        verify(childMessageWriteBehind, never()).enqueue(any(), any(), any(), any(Boolean.class));
    }

    @Test
    void runningChildEventsAreBroadcastAndQueuedWithoutSynchronousDatabaseWrites() {
        JSONObject metadata = childMetadata("worker-child-1", "架构舵手", "架构负责人");
        metadata.put("session_status", "running");
        metadata.put("event_kind", "session.output");
        JSONObject event = streamEvent("reasoningLogDelta", "持续分析", metadata);
        ByaiSession child = childSession(200L, 100L, 900L);
        when(childSessionService.ensureBinding(100L, metadata))
            .thenReturn(new ExternalChildSessionBinding(child, "worker-child-1", 201L));
        when(gatewayStreamEventProcessor.buildEventData(any(ChatProcessContext.class), eq(event), eq(metadata)))
            .thenReturn(event.getString("data"));
        ByaiMessageHotDtoDto persisted = new ByaiMessageHotDtoDto();
        persisted.setMessageId(201L);
        when(memoryMessageService.generateMessage(eq(200L), eq(ChatUseageEnum.SYSTEM_RESPONSE.getCode()),
            any(MessageContext.class), any(AssistantChatDto.class))).thenReturn(persisted);
        when(runningChatSnapshotService.saveExternalChild(persisted, "1-0", false)).thenReturn(true);

        assertThat(service.handleIfNecessary(100L, event)).isTrue();
        assertThat(service.handleIfNecessary(100L, event)).isTrue();

        verify(runningChatSnapshotService).saveExternalChild(persisted, "1-0", false);
        verify(childMessageWriteBehind)
            .enqueue("child:200:201", 200L, persisted, false);
        verify(projectionBroadcaster).enqueue(eq("100:worker-child-1"), eq(900L), any(JSONObject.class), eq(false));
    }

    @Test
    void snapshotFailureKeepsTheStreamEventUnacknowledged() {
        JSONObject metadata = childMetadata("worker-child-1", "架构舵手", "架构负责人");
        JSONObject event = streamEvent("answerDelta", "不能丢失的正文", metadata);
        ByaiSession child = childSession(200L, 100L, 900L);
        when(childSessionService.ensureBinding(100L, metadata))
            .thenReturn(new ExternalChildSessionBinding(child, "worker-child-1", 201L));
        when(gatewayStreamEventProcessor.buildEventData(any(ChatProcessContext.class), eq(event), eq(metadata)))
            .thenReturn(event.getString("data"));
        ByaiMessageHotDtoDto projection = new ByaiMessageHotDtoDto();
        projection.setMessageId(201L);
        when(memoryMessageService.generateMessage(eq(200L), eq(ChatUseageEnum.SYSTEM_RESPONSE.getCode()),
            any(MessageContext.class), any(AssistantChatDto.class))).thenReturn(projection);
        when(runningChatSnapshotService.saveExternalChild(projection, "1-0", true)).thenReturn(false);

        org.assertj.core.api.Assertions.assertThatThrownBy(() -> service.handleIfNecessary(100L, event))
            .isInstanceOf(IllegalStateException.class);

        verify(childMessageWriteBehind, never()).enqueue(any(), any(), any(), any(Boolean.class));
        verify(projectionBroadcaster, never()).enqueue(any(), any(), any(), any(Boolean.class));
    }

    @Test
    void ordinaryParentEventKeepsTheExistingRouterPath() {
        JSONObject metadata = new JSONObject();
        metadata.put("session_scope", "parent");
        JSONObject event = streamEvent("answerDelta", "父会话答案", metadata);

        assertThat(service.handleIfNecessary(100L, event)).isFalse();

        verify(childSessionService, never()).ensureBinding(any(), any());
        verify(childMessageWriteBehind, never()).enqueue(any(), any(), any(), any(Boolean.class));
    }

    private JSONObject childMetadata(String externalSessionId, String name, String role) {
        JSONObject metadata = new JSONObject();
        metadata.put("session_scope", "child");
        metadata.put("external_session_id", externalSessionId);
        metadata.put("external_root_session_id", "worker-root-1");
        metadata.put("event_source", "test-worker");
        metadata.put("team_id", "team-1");
        metadata.put("child_name", name);
        metadata.put("child_role", role);
        metadata.put("session_status", "completed");
        return metadata;
    }

    private JSONObject streamEvent(String eventType, String content, JSONObject metadata) {
        JSONObject delta = new JSONObject();
        delta.put("content", content);
        JSONObject choice = new JSONObject();
        choice.put("index", "0");
        choice.put("finish_reason", "");
        choice.put("delta", delta);
        JSONObject data = new JSONObject();
        data.put("id", "event-1");
        data.put("contentType", "3015");
        data.put("choices", new JSONArray().fluentAdd(choice));

        JSONObject event = new JSONObject();
        event.put("session_id", "100");
        event.put("trace_id", "trace-1");
        event.put("stream_id", "1-0");
        event.put("event_type", eventType);
        event.put("source_agent_type", "EXTERNAL_WORKER_0027024710");
        event.put("metadata", metadata);
        event.put("data", data.toJSONString());
        return event;
    }

    private ByaiSession childSession(Long sessionId, Long parentSessionId, Long creatorId) {
        ByaiSession child = new ByaiSession();
        child.setSessionId(sessionId);
        child.setParentSessionId(parentSessionId);
        child.setCreatorId(creatorId);
        child.setSessionName("架构舵手");
        return child;
    }
}
