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
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatSnapshotResponse;
import com.iwhalecloud.byai.state.domain.chat.enums.ChatUseageEnum;
import com.iwhalecloud.byai.state.domain.chat.model.ExternalChildSessionBinding;
import com.iwhalecloud.byai.state.domain.chat.model.MessageContext;
import com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto;
import com.iwhalecloud.byai.state.domain.message.enums.MsgStatus;
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
        org.mockito.Mockito.lenient().doCallRealMethod().when(runningChatSnapshotService)
            .hydrateMessageContextFromSnapshot(any(), any(), any());
    }

    @Test
    void childEventIsPersistedInItsOwnConversationAndNotRoutedIntoParent() {
        JSONObject metadata = childMetadata("worker-child-1", "架构舵手", "架构负责人");
        metadata.put("event_kind", "session.status");
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
    void lateChildEventDoesNotReopenAPreviouslyCompletedProjection() {
        JSONObject metadata = childMetadata("worker-child-1", "架构舵手", "架构负责人");
        metadata.put("session_status", "running");
        metadata.put("event_kind", "session.output");
        JSONObject event = streamEvent("reasoningLogDelta", "终态后的晚到结论", metadata);
        event.put("stream_id", "2-0");
        ByaiSession child = childSession(200L, 100L, 900L);
        when(childSessionService.ensureBinding(100L, metadata))
            .thenReturn(new ExternalChildSessionBinding(child, "worker-child-1", 201L));

        RunningChatSnapshotResponse existing = new RunningChatSnapshotResponse();
        existing.setSessionId(200L);
        existing.setMessageId(201L);
        existing.setRunning(false);
        when(runningChatSnapshotService.getExternalChildSnapshot(200L, 201L)).thenReturn(existing);
        MessageContext completedContext = new MessageContext(AgentTypeEnum.AGENT, 201L);
        completedContext.setComplete(true);
        org.mockito.Mockito.doReturn(completedContext).when(runningChatSnapshotService)
            .hydrateMessageContextFromSnapshot(any(), any(), any());
        when(gatewayStreamEventProcessor.buildEventData(any(ChatProcessContext.class), eq(event), eq(metadata)))
            .thenReturn(event.getString("data"));

        ByaiMessageHotDtoDto persisted = new ByaiMessageHotDtoDto();
        persisted.setMessageId(201L);
        persisted.setSessionId(200L);
        persisted.setCreatorId(900L);
        when(memoryMessageService.generateMessage(eq(200L), eq(ChatUseageEnum.SYSTEM_RESPONSE.getCode()),
            eq(completedContext), any(AssistantChatDto.class))).thenReturn(persisted);
        when(runningChatSnapshotService.saveExternalChild(eq(persisted), eq("2-0"), any(Boolean.class)))
            .thenReturn(true);

        assertThat(service.handleIfNecessary(100L, event)).isTrue();

        assertThat(persisted.getMsgStatus()).isEqualTo(MsgStatus.FINISH.getCode());
        verify(runningChatSnapshotService).saveExternalChild(persisted, "2-0", true);
        verify(childMessageWriteBehind).enqueue("child:200:201", 200L, persisted, true);
        verify(projectionBroadcaster).enqueue(eq("100:worker-child-1"), eq(900L), any(JSONObject.class), eq(true));
    }

    @Test
    void lateEventFromTheSameVersionedRunKeepsItsTerminalLock() {
        JSONObject metadata = childMetadata("worker-child-1", "架构舵手", "架构负责人");
        metadata.put("session_status", "running");
        metadata.put("event_kind", "session.output");
        metadata.put("child_run_id", "worker-child-1:1");
        metadata.put("child_turn", 1L);
        JSONObject event = streamEvent("reasoningLogDelta", "同轮次终态后的晚到输出", metadata);
        event.put("stream_id", "2-0");
        ByaiSession child = childSession(200L, 100L, 900L);
        when(childSessionService.ensureBinding(100L, metadata))
            .thenReturn(new ExternalChildSessionBinding(child, "worker-child-1", 201L));

        RunningChatSnapshotResponse completedSnapshot = new RunningChatSnapshotResponse();
        completedSnapshot.setSessionId(200L);
        completedSnapshot.setMessageId(201L);
        completedSnapshot.setRunning(false);
        completedSnapshot.setChildRunId("worker-child-1:1");
        completedSnapshot.setChildTurn(1L);
        when(runningChatSnapshotService.getExternalChildSnapshot(200L, 201L)).thenReturn(completedSnapshot);
        MessageContext completedContext = new MessageContext(AgentTypeEnum.AGENT, 201L);
        completedContext.setComplete(true);
        org.mockito.Mockito.doReturn(completedContext).when(runningChatSnapshotService)
            .hydrateMessageContextFromSnapshot(any(), any(), any());
        when(gatewayStreamEventProcessor.buildEventData(any(ChatProcessContext.class), eq(event), eq(metadata)))
            .thenReturn(event.getString("data"));

        ByaiMessageHotDtoDto persisted = new ByaiMessageHotDtoDto();
        persisted.setMessageId(201L);
        persisted.setSessionId(200L);
        persisted.setCreatorId(900L);
        when(memoryMessageService.generateMessage(eq(200L), eq(ChatUseageEnum.SYSTEM_RESPONSE.getCode()),
            eq(completedContext), any(AssistantChatDto.class))).thenReturn(persisted);
        when(runningChatSnapshotService.saveExternalChild(persisted, "2-0", true)).thenReturn(true);

        assertThat(service.handleIfNecessary(100L, event)).isTrue();

        assertThat(persisted.getMsgStatus()).isEqualTo(MsgStatus.FINISH.getCode());
        verify(runningChatSnapshotService).saveExternalChild(persisted, "2-0", true);
        verify(projectionBroadcaster).enqueue(eq("100:worker-child-1"), eq(900L), any(JSONObject.class), eq(true));
    }

    @Test
    void newerChildRunReopensACompletedProjection() {
        JSONObject metadata = childMetadata("worker-child-1", "架构舵手", "架构负责人");
        metadata.put("event_kind", "session.output");
        metadata.put("session_status", "running");
        metadata.put("child_run_id", "worker-child-1:2");
        metadata.put("child_turn", 2L);
        JSONObject event = streamEvent("reasoningLogDelta", "第二轮分析", metadata);
        event.put("stream_id", "3-0");
        ByaiSession child = childSession(200L, 100L, 900L);
        when(childSessionService.ensureBinding(100L, metadata))
            .thenReturn(new ExternalChildSessionBinding(child, "worker-child-1", 201L));

        RunningChatSnapshotResponse completedRunOne = new RunningChatSnapshotResponse();
        completedRunOne.setSessionId(200L);
        completedRunOne.setMessageId(201L);
        completedRunOne.setRunning(false);
        completedRunOne.setChildRunId("worker-child-1:1");
        completedRunOne.setChildTurn(1L);
        when(runningChatSnapshotService.getExternalChildSnapshot(200L, 201L)).thenReturn(completedRunOne);
        when(gatewayStreamEventProcessor.buildEventData(any(ChatProcessContext.class), eq(event), eq(metadata)))
            .thenReturn(event.getString("data"));

        ByaiMessageHotDtoDto persisted = new ByaiMessageHotDtoDto();
        persisted.setMessageId(201L);
        persisted.setSessionId(200L);
        persisted.setCreatorId(900L);
        when(memoryMessageService.generateMessage(eq(200L), eq(ChatUseageEnum.SYSTEM_RESPONSE.getCode()),
            any(MessageContext.class), any(AssistantChatDto.class))).thenReturn(persisted);
        when(runningChatSnapshotService.saveExternalChild(persisted, "3-0", false)).thenReturn(true);

        assertThat(service.handleIfNecessary(100L, event)).isTrue();

        ArgumentCaptor<MessageContext> contextCaptor = ArgumentCaptor.forClass(MessageContext.class);
        verify(pythonSseService).accumulateEvent(any(String.class), contextCaptor.capture());
        assertThat(contextCaptor.getValue().getComplete()).isFalse();
        verify(runningChatSnapshotService, never()).hydrateMessageContext(any(), any());
        verify(runningChatSnapshotService).saveExternalChild(persisted, "3-0", false);
        verify(projectionBroadcaster).enqueue(eq("100:worker-child-1"), eq(900L), any(JSONObject.class), eq(false));
    }

    @Test
    void lateTerminalFromOlderChildRunCannotCloseTheCurrentRun() {
        JSONObject metadata = childMetadata("worker-child-1", "架构舵手", "架构负责人");
        metadata.put("event_kind", "session.status");
        metadata.put("child_run_id", "worker-child-1:1");
        metadata.put("child_turn", 1L);
        JSONObject event = streamEvent("answerDelta", "第一轮晚到终态", metadata);
        event.put("stream_id", "4-0");
        ByaiSession child = childSession(200L, 100L, 900L);
        when(childSessionService.ensureBinding(100L, metadata))
            .thenReturn(new ExternalChildSessionBinding(child, "worker-child-1", 201L));

        RunningChatSnapshotResponse runningRunTwo = new RunningChatSnapshotResponse();
        runningRunTwo.setSessionId(200L);
        runningRunTwo.setMessageId(201L);
        runningRunTwo.setRunning(true);
        runningRunTwo.setChildRunId("worker-child-1:2");
        runningRunTwo.setChildTurn(2L);
        when(runningChatSnapshotService.getExternalChildSnapshot(200L, 201L)).thenReturn(runningRunTwo);

        assertThat(service.handleIfNecessary(100L, event)).isTrue();

        verify(gatewayStreamEventProcessor, never()).buildEventData(any(), any(), any());
        verify(memoryMessageService, never()).generateMessage(any(), any(), any(), any());
        verify(runningChatSnapshotService, never()).saveExternalChild(any(), any(), any(Boolean.class));
        verify(projectionBroadcaster, never()).enqueue(any(), any(), any(), any(Boolean.class));
        verify(childMessageWriteBehind, never()).enqueue(any(), any(), any(), any(Boolean.class));
    }

    @Test
    void completedStatusOnAContentEventDoesNotFinalizeTheChildProjection() {
        JSONObject metadata = childMetadata("worker-child-1", "架构舵手", "架构负责人");
        metadata.put("event_kind", "context");
        JSONObject event = streamEvent("reasoningLogDelta", "上下文注入", metadata);
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
        when(runningChatSnapshotService.saveExternalChild(eq(persisted), eq("1-0"), any(Boolean.class)))
            .thenReturn(true);

        assertThat(service.handleIfNecessary(100L, event)).isTrue();

        assertThat(persisted.getMsgStatus()).isEqualTo(MsgStatus.APPEND.getCode());
        verify(runningChatSnapshotService).saveExternalChild(persisted, "1-0", false);
        verify(childMessageWriteBehind).enqueue("child:200:201", 200L, persisted, false);
        verify(projectionBroadcaster).enqueue(eq("100:worker-child-1"), eq(900L), any(JSONObject.class), eq(false));
    }

    @Test
    void snapshotFailureKeepsTheStreamEventUnacknowledged() {
        JSONObject metadata = childMetadata("worker-child-1", "架构舵手", "架构负责人");
        metadata.put("event_kind", "session.status");
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
    void burstOfChildDeltasBuildsAndPersistsOnlyOneCompleteProjection() {
        JSONObject metadata = childMetadata("worker-child-1", "child", "worker");
        metadata.put("session_status", "running");
        metadata.put("event_kind", "session.output");
        ByaiSession child = childSession(200L, 100L, 900L);
        when(childSessionService.ensureBinding(100L, metadata))
            .thenReturn(new ExternalChildSessionBinding(child, "worker-child-1", 201L));
        when(gatewayStreamEventProcessor.buildEventData(any(), any(), eq(metadata)))
            .thenAnswer(call -> call.getArgument(1, JSONObject.class).getString("data"));
        ByaiMessageHotDtoDto projection = new ByaiMessageHotDtoDto();
        projection.setSessionId(200L);
        projection.setMessageId(201L);
        when(memoryMessageService.generateMessage(any(), any(), any(), any())).thenReturn(projection);
        when(runningChatSnapshotService.saveExternalChild(projection, "100-0", false)).thenReturn(true);
        java.util.List<JSONObject> events = new java.util.ArrayList<>();
        for (int index = 1; index <= 100; index++) {
            JSONObject event = streamEvent("reasoningLogDelta", "delta", metadata);
            event.put("stream_id", index + "-0");
            events.add(event);
        }
        org.springframework.test.util.ReflectionTestUtils.invokeMethod(service, "handleChildBatch", 100L, events);
        verify(pythonSseService, org.mockito.Mockito.times(100)).accumulateEvent(any(), any());
        verify(memoryMessageService).generateMessage(any(), any(), any(), any());
        verify(runningChatSnapshotService).saveExternalChild(projection, "100-0", false);
        verify(runningChatSnapshotService).getExternalChildSnapshot(200L, 201L);
        verify(childMessageWriteBehind).enqueue("child:200:201", 200L, projection, false);
    }

    @Test
    void activeChildReusesRunIdentityInsteadOfReadingWholeSnapshotOnEveryDelta() {
        JSONObject metadata = childMetadata("worker-child-1", "child", "worker");
        metadata.put("session_status", "running");
        metadata.put("event_kind", "session.output");
        ByaiSession child = childSession(200L, 100L, 900L);
        when(childSessionService.ensureBinding(100L, metadata))
            .thenReturn(new ExternalChildSessionBinding(child, "worker-child-1", 201L));
        when(gatewayStreamEventProcessor.buildEventData(any(), any(), eq(metadata)))
            .thenAnswer(call -> call.getArgument(1, JSONObject.class).getString("data"));
        ByaiMessageHotDtoDto projection = new ByaiMessageHotDtoDto();
        projection.setSessionId(200L);
        projection.setMessageId(201L);
        when(memoryMessageService.generateMessage(any(), any(), any(), any())).thenReturn(projection);
        when(runningChatSnapshotService.saveExternalChild(eq(projection), any(), eq(false))).thenReturn(true);
        for (int i = 1; i <= 3; i++) {
            JSONObject event = streamEvent("reasoningLogDelta", "delta", metadata);
            event.put("stream_id", i + "-0");
            service.handleIfNecessary(100L, event);
        }
        verify(runningChatSnapshotService).getExternalChildSnapshot(200L, 201L);
    }

    @Test
    void retryAfterAmbiguousSnapshotSuccessStillSchedulesDatabasePersistence() {
        JSONObject metadata = childMetadata("worker-child-1", "child", "worker");
        JSONObject event = streamEvent("answerDelta", "output", metadata);
        ByaiSession child = childSession(200L, 100L, 900L);
        when(childSessionService.ensureBinding(100L, metadata))
            .thenReturn(new ExternalChildSessionBinding(child, "worker-child-1", 201L));
        RunningChatSnapshotResponse checkpoint = new RunningChatSnapshotResponse();
        checkpoint.setSessionId(200L);
        checkpoint.setMessageId(201L);
        checkpoint.setModelAnswerMessageId(201L);
        checkpoint.setSnapshotStreamId("1-0");
        checkpoint.setRunning(false);
        checkpoint.setMetadata("{\"event_stream_id\":\"1-0\"}");
        checkpoint.setMessageContent("durable output");
        when(runningChatSnapshotService.getExternalChildSnapshot(200L, 201L)).thenReturn(checkpoint);
        org.mockito.Mockito.lenient().when(runningChatSnapshotService.saveExternalChild(any(), eq("1-0"), eq(true)))
            .thenReturn(true);
        service.handleIfNecessary(100L, event);
        verify(childMessageWriteBehind).enqueue(eq("child:200:201"), eq(200L), any(), eq(true));
    }

    @Test
    void successfullyReadSnapshotIsHydratedWithoutASecondRedisGet() {
        JSONObject metadata = childMetadata("worker-child-1", "child", "worker");
        metadata.put("session_status", "running");
        JSONObject event = streamEvent("reasoningLogDelta", "delta", metadata);
        event.put("stream_id", "2-0");
        ByaiSession child = childSession(200L, 100L, 900L);
        when(childSessionService.ensureBinding(100L, metadata))
            .thenReturn(new ExternalChildSessionBinding(child, "worker-child-1", 201L));
        org.springframework.data.redis.core.RedisTemplate<String, Object> redis = org.mockito.Mockito.mock(
            org.springframework.data.redis.core.RedisTemplate.class);
        org.springframework.data.redis.core.ValueOperations<String, Object> values = org.mockito.Mockito.mock(
            org.springframework.data.redis.core.ValueOperations.class);
        when(redis.opsForValue()).thenReturn(values);
        RunningChatSnapshotResponse checkpoint = new RunningChatSnapshotResponse();
        checkpoint.setSessionId(200L);
        checkpoint.setMessageId(201L);
        checkpoint.setModelAnswerMessageId(201L);
        checkpoint.setSnapshotStreamId("1-0");
        checkpoint.setRunning(true);
        checkpoint.setMessageContent("previous output");
        when(values.get("byai:chat:running:snapshot:200:external-child-200"))
            .thenReturn(JSON.toJSONString(checkpoint)).thenThrow(new IllegalStateException("second read failed"));
        RunningChatSnapshotService snapshots = org.mockito.Mockito.spy(new RunningChatSnapshotService());
        org.springframework.test.util.ReflectionTestUtils.setField(snapshots, "redisTemplate", redis);
        org.mockito.Mockito.doReturn(true).when(snapshots).saveExternalChild(any(), any(), eq(false));
        service = new ScopedSessionEventService(childSessionService, gatewayStreamEventProcessor, pythonSseService,
            memoryMessageService, projectionBroadcaster, snapshots, childMessageWriteBehind);
        when(gatewayStreamEventProcessor.buildEventData(any(), any(), any())).thenReturn(event.getString("data"));
        ByaiMessageHotDtoDto projection = new ByaiMessageHotDtoDto();
        when(memoryMessageService.generateMessage(any(), any(), any(), any())).thenAnswer(call -> {
            assertThat(call.getArgument(2, MessageContext.class).returnAnswerText()).isEqualTo("previous output");
            return projection;
        });
        service.handleIfNecessary(100L, event);
        verify(values).get("byai:chat:running:snapshot:200:external-child-200");
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
