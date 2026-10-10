package com.iwhalecloud.byai.state.domain.chat.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MirrorAnswerPayload;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MirrorAnswerMetadata;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MirrorGroupDisposition;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MirrorEvent;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MirrorInputPayload;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MessageView;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatDispositionReader;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import java.util.Map;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import jakarta.annotation.PreDestroy;
import org.springframework.scheduling.annotation.Scheduled;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/** Commits the existing chat pipeline's messages through the tenant Node REST boundary. */
@Service
public class TenantChatMirrorService {
    private static final Logger log = LoggerFactory.getLogger(TenantChatMirrorService.class);

    private final TenantNodeClient node;
    private final ObjectMapper objectMapper;
    private final GroupChatEventPublisher groupEvents;

    @org.springframework.beans.factory.annotation.Autowired
    private TenantScopedSessionEventService tenantProjections;

    private GroupChatDispositionReader dispositionReader;
    private UserService users;
    private final Map<ChatProcessContext, Observation> observations = new ConcurrentHashMap<>();
    private final ThreadPoolExecutor observers = new ThreadPoolExecutor(4, 4, 0L, TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<>(128));

    @org.springframework.beans.factory.annotation.Autowired
    public void configureDisposition(GroupChatDispositionReader reader, UserService users) {
        this.dispositionReader = reader;
        this.users = users;
    }

    public TenantChatMirrorService(TenantNodeClient node, ObjectMapper objectMapper,
        GroupChatEventPublisher groupEvents) {
        this.node = node;
        this.objectMapper = objectMapper;
        this.groupEvents = groupEvents;
    }

    public void input(ChatProcessContext context) {
        if (tenantProjections != null) tenantProjections.remember(context.sessionId, context.tenantContext);
        String userMessageId = context.userMessageId.toString();
        node.mirror(context.tenantContext, event(context, "INPUT", "0", "input-" + userMessageId,
            new MirrorInputPayload(userMessageId, Long.toString(context.tenantContext.userId()), null,
                context.assistantChatDto.getChatContent())));
        if (candidate(context) != null) observations.putIfAbsent(context, new Observation());
    }

    public void terminal(ChatProcessContext context) {
        synchronized (context) {
            Observation observation = observations.get(context);
            if (observation != null) observation.closing = true;
            commitTerminal(context);
            observations.remove(context);
        }
    }

    private void commitTerminal(ChatProcessContext context) {
        Map<String, Object> state = terminalState(context);
        if (matchesInitialAnswer(context, state) && Boolean.TRUE.equals(state.get("answerTerminal"))) {
            // A resumed context may have different transient metadata; do not rewrite an already committed answer.
            notifyGroupReply(context, false);
            return;
        }
        String answerMessageId = context.modelAnswerMessageId.toString();
        String content = context.messageContext.getExplicitFinalAnswer();
        if (content == null) content = visibleText(context.messageContext);
        boolean ordered = java.util.stream.Stream.concat(context.messageContext.getAnswerMessageList().stream(),
            context.messageContext.getReasonMessageList().stream()).anyMatch(segment -> segment.getSeq() != null);
        MirrorAnswerMetadata metadata = metadata(context.assistantChatDto.getMetadata(), ordered, disposition(context, true));
        String sequence = terminalSequence(context, state);
        node.mirror(context.tenantContext, event(context, context.gatewayError ? "ERROR" : "TERMINAL",
            sequence, "terminal-" + answerMessageId,
            new MirrorAnswerPayload(answerMessageId, context.taskId.toString(), content, content,
                metadata == null ? null : metadata.resourceName(), metadata,
                context.messageContext.getAnswerMessageList(),
                context.messageContext.getReasonMessageList())));
        notifyGroupReply(context, false);
    }

    /** Like personal-space observation, this watches only locally registered, trusted running candidates. */
    @Scheduled(fixedDelayString = "${byclaw.group-chat.classification-observe-ms:500}")
    public void observeClassifications() {
        observations.forEach((context, observation) -> {
            if (observation.closing || observation.disposition != null || !observation.inFlight.compareAndSet(false, true)) return;
            try {
                observers.execute(() -> {
                    try { observeClassification(context); }
                    catch (RuntimeException error) { log.warn("租户群聊分类观察失败, sessionId={}", context.sessionId, error); }
                    finally { observation.inFlight.set(false); }
                });
            }
            catch (java.util.concurrent.RejectedExecutionException error) { observation.inFlight.set(false); }
        });
    }

    void observeClassification(ChatProcessContext context) {
        synchronized (context) {
            Observation observation = observations.get(context);
            if (observation == null || observation.closing || observation.disposition != null) return;
            MirrorGroupDisposition disposition = disposition(context, false);
            if (disposition == null) return;
            node.mirror(context.tenantContext, event(context, "DELTA", "1",
                "disposition-" + context.modelAnswerMessageId,
                new MirrorAnswerPayload(context.modelAnswerMessageId.toString(), context.taskId.toString(), "", null,
                    null, metadata(context.assistantChatDto.getMetadata(), false, disposition), List.of(), List.of())));
            observation.disposition = disposition;
            if ("TASK".equals(disposition.kind())) notifyGroupReply(context, true);
        }
    }

    private Map<?, ?> candidate(ChatProcessContext context) {
        Map<String, Object> params = context.assistantChatDto.getExtParams();
        if (params == null || !Boolean.TRUE.equals(params.get("tenantGroupCandidate"))) return null;
        if (params.get("groupCoordination") instanceof Map<?, ?> scope && "COORDINATED".equals(scope.get("mode"))) return null;
        return params.get("groupDispatch") instanceof Map<?, ?> dispatch ? dispatch : null;
    }

    private MirrorGroupDisposition disposition(ChatProcessContext context, boolean terminal) {
        Map<?, ?> dispatch = candidate(context);
        if (dispatch == null) return null;
        Observation observation = observations.get(context);
        if (observation != null && observation.disposition != null) return observation.disposition;
        String dispatchId = String.valueOf(dispatch.get("dispatchId"));
        var user = users == null ? null : users.findById(context.tenantContext.userId());
        var value = dispositionReader == null || user == null ? null
            : dispositionReader.read(user.getUserCode(), context.sessionId, Long.valueOf(dispatchId));
        if (value == null) return terminal ? new MirrorGroupDisposition("1", dispatchId, "CHAT", null, null) : null;
        return new MirrorGroupDisposition(value.getSchemaVersion(), value.getDispatchId(), value.getKind(),
            value.getTaskName(), value.getAckText());
    }

    private Map<String, Object> terminalState(ChatProcessContext context) {
        if (context.assistantChatDto.getExtParams().get("groupDispatch") instanceof Map<?, ?>) {
            return node.request(context.tenantContext, "GET",
                "/internal/v1/group-chat/dispatches/" + context.sessionId, null, new TypeReference<Map<String, Object>>() { });
        }
        return null;
    }

    private boolean matchesInitialAnswer(ChatProcessContext context, Map<String, Object> stored) {
        String traceId = context.traceId == null ? "trace-" + context.modelAnswerMessageId : context.traceId;
        return stored != null && context.modelAnswerMessageId.toString().equals(String.valueOf(stored.get("answerMessageId")))
            && traceId.equals(stored.get("traceId"));
    }

    private String terminalSequence(ChatProcessContext context, Map<String, Object> stored) {
        if (matchesInitialAnswer(context, stored) && stored.get("answerLastSeq") != null)
            return Long.toString(Long.parseLong(stored.get("answerLastSeq").toString()) + 1);
        Observation observation = observations.get(context);
        return observation != null && observation.disposition != null ? "2" : "1";
    }

    @PreDestroy
    public void shutdown() { observers.shutdown(); }

    private static final class Observation {
        private final AtomicBoolean inFlight = new AtomicBoolean();
        private volatile MirrorGroupDisposition disposition;
        private volatile boolean closing;
    }

    private void notifyGroupReply(ChatProcessContext context, boolean created) {
        Map<String, Object> params = context.assistantChatDto.getExtParams();
        Object taskId = params == null ? null : params.get("tenantGroupTask");
        if (taskId == null) return;
        try {
            boolean candidate = params.get("groupDispatch") instanceof Map<?, ?>;
            Map<String, Object> task = node.request(context.tenantContext, "GET",
                "/internal/v1/group-chat/" + (candidate ? "dispatches/" : "tasks/") + taskId, null,
                new TypeReference<Map<String, Object>>() { });
            boolean formalTask = !candidate || "TASK".equals(task.get("disposition"));
            Object messageId = task.get("publishMessageId");
            Object groupId = task.get("groupSessionId");
            if (groupId == null) return;
            if (candidate && formalTask) {
                Map<String, Object> persisted = node.request(context.tenantContext, "GET",
                    "/internal/v1/group-chat/tasks/" + taskId, null, new TypeReference<Map<String, Object>>() { });
                task = new java.util.HashMap<>(task);
                task.putAll(persisted);
            }
            Object coordination = params.get("groupCoordination");
            if (formalTask && task.get("status") != null && task.get("turnStatus") != null) {
                JSONObject status = new JSONObject();
                status.put("type", "GROUP_CHAT_EVENT");
                status.put("event", created ? "TASK_CREATED" : "TASK_STATUS_CHANGED");
                status.put("sessionId", groupId.toString());
                status.put("taskId", taskId.toString());
                status.put("sourceMessageId", task.get("sourceMessageId"));
                status.put("targetAgentId", task.get("targetAgentId"));
                status.put("taskName", task.get("taskName"));
                status.put("status", task.get("status"));
                status.put("turnStatus", task.get("turnStatus"));
                if (coordination != null) status.put("groupCoordination", coordination);
                groupEvents.publishTenant(context.tenantContext, Long.valueOf(groupId.toString()), status);
            }
            if (coordination instanceof Map<?, ?> scope && "COORDINATED".equals(scope.get("mode"))) return;
            if (context.gatewayError || messageId == null) return;
            List<MessageView> committed = node.request(context.tenantContext, "POST",
                "/internal/v1/assiman/getMessageByIds", Map.of("messageIds", List.of(messageId.toString())),
                new TypeReference<List<MessageView>>() { });
            if (committed == null || committed.size() != 1) return;
            MessageView stored = committed.get(0);
            JSONObject event = new JSONObject();
            event.put("type", "GROUP_CHAT_EVENT");
            event.put("event", "MESSAGE_CREATED");
            event.put("sessionId", groupId.toString());
            event.put("messageId", messageId.toString());
            event.put("messageRef", task.get("sourceMessageId"));
            event.put("topicId", stored.getTopicId());
            event.put("creatorId", task.get("targetAgentId"));
            event.put("creatorName", stored.getCreatorName());
            event.put("content", stored.getMessageContent());
            event.put("metadata", stored.getMetadata());
            if (stored.getMetadata() != null) {
                JSONObject metadata = JSONObject.parseObject(stored.getMetadata());
                event.put("kind", metadata.get("kind"));
                event.put("taskId", metadata.get("taskId"));
            }
            event.put("speaker", Map.of("type", "AGENT", "agentId", task.get("targetAgentId"),
                "displayName", stored.getCreatorName() == null ? "" : stored.getCreatorName()));
            groupEvents.publishTenant(context.tenantContext, Long.valueOf(groupId.toString()), event);
        }
        catch (RuntimeException error) {
            log.warn("租户群回复已提交但广播失败, taskId={}", taskId, error);
        }
    }

    static String visibleText(com.iwhalecloud.byai.state.domain.chat.model.MessageContext message) {
        if (message.getAnswerMessageList().isEmpty()) return message.getAnswerText().toString();
        StringBuilder text = new StringBuilder();
        for (var segment : message.getAnswerMessageList()) {
            if (!"1002".equals(segment.getContentType()) || segment.getChoices() == null) continue;
            for (var choice : segment.getChoices()) {
                if (choice.getDelta() != null && choice.getDelta().getContent() != null)
                    text.append(choice.getDelta().getContent());
            }
        }
        return text.toString();
    }

    private MirrorAnswerMetadata metadata(String value, boolean ordered, MirrorGroupDisposition disposition) {
        if ((value == null || value.isBlank()) && !ordered && disposition == null) return null;
        try {
            var metadata = value == null || value.isBlank() ? objectMapper.createObjectNode() : objectMapper.readTree(value);
            if (metadata instanceof com.fasterxml.jackson.databind.node.ObjectNode object) {
                object.remove("groupDisposition"); // Never accept classification from the incoming DTO.
                if (disposition != null) object.set("groupDisposition", objectMapper.valueToTree(disposition));
                if (ordered) object.put("messageRenderVersion", "v2");
            }
            return objectMapper.treeToValue(metadata, MirrorAnswerMetadata.class);
        } catch (JsonProcessingException error) {
            throw new IllegalArgumentException("tenant answer metadata is invalid", error);
        }
    }

    private MirrorEvent event(ChatProcessContext context, String eventType, String sequence,
                              String eventId, com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MirrorPayload payload) {
        String traceId = context.traceId == null ? "trace-" + context.modelAnswerMessageId : context.traceId;
        String clientRequestId = context.clientRequestId == null || context.clientRequestId.isBlank()
            ? "turn-" + context.userMessageId : context.clientRequestId;
        return new MirrorEvent(context.sessionId.toString(), clientRequestId, traceId, traceId,
            context.userMessageId.toString(), context.modelAnswerMessageId.toString(), eventId,
            null, 0, sequence, eventType, payload);
    }
}
