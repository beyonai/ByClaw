package com.iwhalecloud.byai.state.domain.chat.service;

import java.util.LinkedHashMap;
import java.util.List;
import org.springframework.beans.BeanUtils;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.state.common.enums.AgentTypeEnum;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.dto.ChatRuntimeState;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatSnapshotResponse;
import com.iwhalecloud.byai.state.domain.chat.enums.ChatUseageEnum;
import com.iwhalecloud.byai.state.domain.chat.model.ExternalChildSessionBinding;
import com.iwhalecloud.byai.state.domain.chat.model.MessageContext;
import com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto;
import com.iwhalecloud.byai.state.domain.message.enums.MsgStatus;
import com.iwhalecloud.byai.state.domain.message.service.MemoryMessageService;
import com.iwhalecloud.byai.state.infrastructure.common.constants.SseResponseEventEnum;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

/**
 * 分流通用外部子会话事件，并为 AgentTeams 快照补充 ByClaw 子会话导航信息。
 */
@Service
public class ScopedSessionEventService {

    private static final String SCOPE_CHILD = "child";

    private static final String SCOPE_TEAM = "team";

    private static final String TEAM_SNAPSHOT_EVENT = "agent-teams/snapshot";

    private static final String SESSION_STATUS_EVENT = "session.status";

    private static final Set<String> TERMINAL_STATUSES = Set.of("completed", "failed", "cancelled", "canceled",
        "stopped", "error");

    private static final Set<String> TERMINAL_EVENTS = Set.of("session.error", "error");

    private final ExternalChildSessionService childSessionService;

    private final GatewayStreamEventProcessor gatewayStreamEventProcessor;

    private final PythonSseService pythonSseService;

    private final MemoryMessageService memoryMessageService;

    private final ScopedProjectionBroadcaster projectionBroadcaster;

    private final RunningChatSnapshotService runningChatSnapshotService;

    private final ScopedMessageWriteBehind childMessageWriteBehind;

    private final Map<String, MessageContext> childMessageContexts = new ConcurrentHashMap<>();

    private final Map<String, RunningChatSnapshotResponse> childRunSnapshots = new ConcurrentHashMap<>();

    private final Map<String, String> childStreamWatermarks = new ConcurrentHashMap<>();

    public ScopedSessionEventService(
            ExternalChildSessionService childSessionService,
            GatewayStreamEventProcessor gatewayStreamEventProcessor,
            PythonSseService pythonSseService,
            MemoryMessageService memoryMessageService,
            ScopedProjectionBroadcaster projectionBroadcaster,
            RunningChatSnapshotService runningChatSnapshotService,
            ScopedMessageWriteBehind childMessageWriteBehind
    ) {
        this.childSessionService = childSessionService;
        this.gatewayStreamEventProcessor = gatewayStreamEventProcessor;
        this.pythonSseService = pythonSseService;
        this.memoryMessageService = memoryMessageService;
        this.projectionBroadcaster = projectionBroadcaster;
        this.runningChatSnapshotService = runningChatSnapshotService;
        this.childMessageWriteBehind = childMessageWriteBehind;
    }

    /**
     * @return {@code true} 表示事件已作为子会话事件完全处理，调用方不得再写入父会话。
     */
    public boolean handleIfNecessary(Long parentSessionId, JSONObject dataJson) {
        JSONObject metadata = dataJson == null ? null : dataJson.getJSONObject("metadata");
        String scope = metadata == null ? null : metadata.getString("session_scope");
        if (SCOPE_TEAM.equals(scope)) {
            enrichTeamSnapshot(parentSessionId, dataJson, metadata);
            return false;
        }
        if (!SCOPE_CHILD.equals(scope)) {
            return false;
        }
        persistChildEvent(parentSessionId, dataJson, metadata);
        return true;
    }

    private void persistChildEvent(Long parentSessionId, JSONObject dataJson, JSONObject metadata) {
        handleChildBatch(parentSessionId, List.of(dataJson));
    }

    /** Called under the processor's session lock; all events belong to the same child and run. */
    public void handleChildBatch(Long parentSessionId, List<JSONObject> events) {
        if (events.isEmpty()) return;
        JSONObject metadata = events.getFirst().getJSONObject("metadata");
        ExternalChildSessionBinding binding = childSessionService.ensureBinding(parentSessionId, metadata);
        String contextKey = parentSessionId + ":" + binding.externalSessionId();
        boolean restoring = !childMessageContexts.containsKey(contextKey);
        RunningChatSnapshotResponse currentSnapshot = !restoring
            ? childRunSnapshots.get(contextKey)
            : runningChatSnapshotService.getExternalChildSnapshot(binding.session().getSessionId(), binding.messageId());
        if (currentSnapshot != null) childRunSnapshots.put(contextKey, currentSnapshot);
        ChildRunDisposition disposition = compareChildRun(currentSnapshot, metadata);
        if (disposition == ChildRunDisposition.STALE) return;
        MessageContext messageContext;
        if (disposition == ChildRunDisposition.NEWER) {
            messageContext = new MessageContext(AgentTypeEnum.AGENT, binding.messageId());
            childMessageContexts.put(contextKey, messageContext);
            childStreamWatermarks.remove(contextKey);
        }
        else {
            messageContext = childMessageContexts.computeIfAbsent(contextKey,
                ignored -> restoreMessageContext(contextKey, binding, currentSnapshot));
        }
        ChatProcessContext eventContext = new ChatProcessContext(null, null);
        eventContext.sessionId = binding.session().getSessionId();
        eventContext.userMessageId = 0L;
        LoginInfo previousLoginInfo = CurrentUserHolder.getLoginInfo();
        try {
            CurrentUserHolder.setLoginInfo(buildLoginInfo(binding.session()));
            String watermark = childStreamWatermarks.get(contextKey);
            JSONObject lastEvent = null;
            boolean terminal = Boolean.TRUE.equals(messageContext.getComplete());
            for (JSONObject event : events) {
                String streamId = event.getString("stream_id");
                if (StreamIdUtil.isProcessedByWatermark(streamId, watermark)) continue;
                JSONObject eventMetadata = event.getJSONObject("metadata");
                String eventData = gatewayStreamEventProcessor.buildEventData(eventContext, event, eventMetadata);
                JSONObject line = new JSONObject();
                line.put("event", event.getString("event_type"));
                line.put("data", eventData);
                pythonSseService.accumulateEvent(line.toJSONString(), messageContext);
                terminal = terminal || isTerminal(event, eventMetadata) || Boolean.TRUE.equals(messageContext.getComplete());
                if (terminal) messageContext.setComplete(true);
                watermark = StreamIdUtil.max(watermark, streamId, streamId);
                lastEvent = event;
            }
            if (lastEvent == null) {
                if (restoring && currentSnapshot != null) ensureReplayedSnapshotPersistence(contextKey, binding, currentSnapshot);
                if (terminal) discardChildContext(contextKey);
                return;
            }
            JSONObject messageMetadata = new JSONObject(lastEvent.getJSONObject("metadata"));
            messageMetadata.put("event_stream_id", watermark);
            AssistantChatDto assistant = new AssistantChatDto();
            assistant.setAccessTerminal("Web");
            assistant.setMetadata(messageMetadata.toJSONString());
            ByaiMessageHotDtoDto persisted = memoryMessageService.generateMessage(binding.session().getSessionId(),
                ChatUseageEnum.SYSTEM_RESPONSE.getCode(), messageContext, assistant);
            persisted.setMsgStatus(terminal ? MsgStatus.FINISH.getCode() : MsgStatus.APPEND.getCode());
            // The caller ACKs the whole batch only after this durable checkpoint succeeds.
            if (!runningChatSnapshotService.saveExternalChild(persisted, watermark, terminal)) {
                throw new IllegalStateException("external child snapshot was not persisted");
            }
            broadcastChildMessage(contextKey, binding.session(), persisted, watermark, terminal);
            childMessageWriteBehind.enqueue("child:" + binding.session().getSessionId() + ":" + binding.messageId(),
                binding.session().getSessionId(), persisted, terminal);
            if (StringUtils.isNotBlank(watermark)) childStreamWatermarks.put(contextKey, watermark);
            RunningChatSnapshotResponse identity = new RunningChatSnapshotResponse();
            identity.setChildRunId(messageMetadata.getString("child_run_id"));
            identity.setChildTurn(messageMetadata.getLong("child_turn"));
            childRunSnapshots.put(contextKey, identity);
            if (terminal) discardChildContext(contextKey);
        }
        catch (RuntimeException e) {
            // Discard uncheckpointed mutations, so a PEL retry cannot append the same deltas twice.
            discardChildContext(contextKey);
            throw e;
        }
        finally {
            if (previousLoginInfo == null) CurrentUserHolder.clearLoginInfo();
            else CurrentUserHolder.setLoginInfo(previousLoginInfo);
        }
    }

    private void discardChildContext(String contextKey) {
        childMessageContexts.remove(contextKey);
        childStreamWatermarks.remove(contextKey);
        childRunSnapshots.remove(contextKey);
    }

    private ChildRunDisposition compareChildRun(RunningChatSnapshotResponse snapshot, JSONObject metadata) {
        if (snapshot == null) {
            return ChildRunDisposition.SAME_OR_LEGACY;
        }
        String currentRunId = StringUtils.trimToNull(snapshot.getChildRunId());
        Long currentTurn = snapshot.getChildTurn();
        String incomingRunId = metadata == null ? null : StringUtils.trimToNull(metadata.getString("child_run_id"));
        Long incomingTurn = metadata == null ? null : metadata.getLong("child_turn");

        // An old worker has no run identity. Keep the legacy terminal-lock behavior because a safe order
        // cannot be inferred across protocols.
        if (currentRunId == null || currentTurn == null || incomingRunId == null || incomingTurn == null) {
            return ChildRunDisposition.SAME_OR_LEGACY;
        }
        int turnOrder = Long.compare(incomingTurn, currentTurn);
        if (turnOrder > 0) {
            return ChildRunDisposition.NEWER;
        }
        if (turnOrder < 0) {
            return ChildRunDisposition.STALE;
        }
        return Objects.equals(incomingRunId, currentRunId)
            ? ChildRunDisposition.SAME_OR_LEGACY
            : ChildRunDisposition.STALE;
    }

    private enum ChildRunDisposition {
        SAME_OR_LEGACY,
        NEWER,
        STALE
    }

    private void ensureReplayedSnapshotPersistence(String contextKey, ExternalChildSessionBinding binding,
            RunningChatSnapshotResponse snapshot) {
        ByaiMessageHotDtoDto message = new ByaiMessageHotDtoDto();
        BeanUtils.copyProperties(snapshot, message);
        JSONObject metadata = JSON.parseObject(StringUtils.defaultIfBlank(message.getMetadata(), "{}"));
        metadata.put("event_stream_id", snapshot.getSnapshotStreamId());
        message.setMetadata(metadata.toJSONString());
        if (runningChatSnapshotService.isExternalChildPersisted(message)) return;
        boolean terminal = Boolean.FALSE.equals(snapshot.getRunning());
        // A write may commit while its reply is lost. Repair its recovery index before ACKing a replay.
        if (!runningChatSnapshotService.saveExternalChild(message, snapshot.getSnapshotStreamId(), terminal)) {
            throw new IllegalStateException("external child replay checkpoint was not persisted");
        }
        childMessageWriteBehind.enqueue("child:" + binding.session().getSessionId() + ":" + binding.messageId(),
            binding.session().getSessionId(), message, terminal);
        broadcastChildMessage(contextKey, binding.session(), message, snapshot.getSnapshotStreamId(), terminal);
    }

    private MessageContext restoreMessageContext(String contextKey, ExternalChildSessionBinding binding,
            RunningChatSnapshotResponse snapshot) {
        if (snapshot == null) return new MessageContext(AgentTypeEnum.AGENT, binding.messageId());
        ChatRuntimeState state = new ChatRuntimeState();
        state.setSessionId(binding.session().getSessionId());
        state.setTraceId(RunningChatSnapshotService.externalChildTraceId(binding.session().getSessionId()));
        state.setModelAnswerMessageId(binding.messageId());
        String[] watermark = new String[1];
        MessageContext restored = runningChatSnapshotService.hydrateMessageContextFromSnapshot(state, snapshot, watermark);
        if (restored != null) {
            if (StringUtils.isNotBlank(watermark[0])) {
                childStreamWatermarks.put(contextKey, watermark[0]);
            }
            return restored;
        }
        throw new IllegalStateException("existing child snapshot could not be hydrated");
    }

    private LoginInfo buildLoginInfo(ByaiSession child) {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(child.getCreatorId());
        loginInfo.setUserName(child.getSessionName());
        loginInfo.setEnterpriseId(child.getEnterpriseId());
        return loginInfo;
    }

    private void broadcastChildMessage(String contextKey, ByaiSession child, ByaiMessageHotDtoDto message,
            String streamId, boolean terminal) {
        if (child.getCreatorId() == null) {
            return;
        }
        JSONObject wsMessage = new JSONObject();
        wsMessage.put("type", "NEW_MESSAGE");
        wsMessage.put("sessionId", String.valueOf(child.getSessionId()));
        wsMessage.put("streamId", streamId);
        wsMessage.put("data", JSON.toJSON(message));
        projectionBroadcaster.enqueue(contextKey, child.getCreatorId(), wsMessage, terminal);
    }

    private boolean isTerminal(JSONObject dataJson, JSONObject metadata) {
        String eventType = normalize(dataJson == null ? null : dataJson.getString("event_type"));
        String externalEvent = normalize(metadata == null ? null : metadata.getString("event_kind"));
        String status = normalize(metadata == null ? null : metadata.getString("session_status"));
        return normalize(SseResponseEventEnum.appStreamResponse).equals(eventType)
            || normalize(SseResponseEventEnum.error).equals(eventType)
            || TERMINAL_EVENTS.contains(externalEvent)
            || (SESSION_STATUS_EVENT.equals(externalEvent) && TERMINAL_STATUSES.contains(status));
    }

    private String normalize(String value) {
        return StringUtils.trimToEmpty(value).toLowerCase(Locale.ROOT);
    }

    private void enrichTeamSnapshot(Long parentSessionId, JSONObject dataJson, JSONObject metadata) {
        JSONObject answerDelta = parseObject(dataJson.getString("data"));
        JSONObject delta = firstDelta(answerDelta);
        JSONObject card = delta == null ? null : parseObject(delta.getString("content"));
        if (card == null || !TEAM_SNAPSHOT_EVENT.equals(card.getString("eventKind"))) {
            return;
        }
        JSONObject team = card.getJSONObject("team");
        JSONArray members = team == null ? null : team.getJSONArray("members");
        if (members == null) {
            return;
        }

        for (int index = 0; index < members.size(); index++) {
            JSONObject member = members.getJSONObject(index);
            String externalSessionId = member == null ? null : StringUtils.trim(member.getString("id"));
            if (StringUtils.isBlank(externalSessionId)) {
                continue;
            }
            JSONObject childMetadata = new JSONObject(new LinkedHashMap<>(metadata));
            childMetadata.put("session_scope", SCOPE_CHILD);
            childMetadata.put("external_session_id", externalSessionId);
            childMetadata.put("child_name", member.getString("name"));
            childMetadata.put("child_role", member.getString("role"));
            childMetadata.put("child_task", member.getString("currentTask"));
            childMetadata.put("session_status", member.getString("status"));
            ExternalChildSessionBinding binding = childSessionService.ensureBinding(parentSessionId, childMetadata);
            member.put("byclawSessionId", String.valueOf(binding.session().getSessionId()));
        }

        delta.put("content", card.toJSONString());
        dataJson.put("data", answerDelta.toJSONString());
    }

    private JSONObject firstDelta(JSONObject answerDelta) {
        JSONArray choices = answerDelta == null ? null : answerDelta.getJSONArray("choices");
        if (choices == null || choices.isEmpty()) {
            return null;
        }
        JSONObject choice = choices.getJSONObject(0);
        return choice == null ? null : choice.getJSONObject("delta");
    }

    private JSONObject parseObject(String value) {
        if (StringUtils.isBlank(value)) {
            return null;
        }
        try {
            return JSON.parseObject(value);
        }
        catch (Exception ignored) {
            return null;
        }
    }
}
