package com.iwhalecloud.byai.state.domain.groupchat.infrastructure;

import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatExecutionMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatExecutionCoordinator;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatExecution;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatCandidateSessionService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTaskService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatMentionService;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatDisposition;
import com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatAgentMention;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;
import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Redis Stream 群委派适配器，负责分类、任务私有流以及公开消息投影。 */
@Service
public class GroupChatExecutionEventHandler {
    private final ByaiMessageMapper messageMapper;
    private final GroupChatEventPublisher eventPublisher;
    private final SequenceService sequenceService;
    private final ByaiGroupChatExecutionMapper executionMapper;
    private final GroupChatExecutionCoordinator executionCoordinator;
    private final SsResourceService resourceService;
    private final UserService userService;
    private final GroupChatDispositionReader dispositionReader;
    private final GroupChatTaskService taskService;
    private final GroupChatCandidateSessionService candidateSessionService;
    private final MultiDeviceBroadcastService multiDeviceBroadcastService;
    private final GroupChatAgentMentionParser mentionParser;
    private final GroupChatMentionService mentionService;
    private final Map<String, GroupChatFinalAnswerExtractor> extractors = new ConcurrentHashMap<>();
    private final Map<String, Boolean> completedExecutions = new ConcurrentHashMap<>();

    @Autowired
    public GroupChatExecutionEventHandler(ByaiMessageMapper messageMapper, GroupChatEventPublisher eventPublisher,
        SequenceService sequenceService, ByaiGroupChatExecutionMapper executionMapper,
        GroupChatExecutionCoordinator executionCoordinator, SsResourceService resourceService,
        UserService userService, GroupChatDispositionReader dispositionReader, GroupChatTaskService taskService,
        GroupChatCandidateSessionService candidateSessionService,
        MultiDeviceBroadcastService multiDeviceBroadcastService, GroupChatAgentMentionParser mentionParser,
        GroupChatMentionService mentionService) {
        this.messageMapper = messageMapper;
        this.eventPublisher = eventPublisher;
        this.sequenceService = sequenceService;
        this.executionMapper = executionMapper;
        this.executionCoordinator = executionCoordinator;
        this.resourceService = resourceService;
        this.userService = userService;
        this.dispositionReader = dispositionReader;
        this.taskService = taskService;
        this.candidateSessionService = candidateSessionService;
        this.multiDeviceBroadcastService = multiDeviceBroadcastService;
        this.mentionParser = mentionParser;
        this.mentionService = mentionService;
    }

    public GroupChatExecutionEventHandler(ByaiMessageMapper messageMapper, GroupChatEventPublisher eventPublisher,
        SequenceService sequenceService, ByaiGroupChatExecutionMapper executionMapper,
        GroupChatExecutionCoordinator executionCoordinator, SsResourceService resourceService,
        UserService userService, GroupChatDispositionReader dispositionReader, GroupChatTaskService taskService,
        GroupChatCandidateSessionService candidateSessionService,
        MultiDeviceBroadcastService multiDeviceBroadcastService, GroupChatAgentMentionParser mentionParser) {
        this(messageMapper, eventPublisher, sequenceService, executionMapper, executionCoordinator, resourceService,
            userService, dispositionReader, taskService, candidateSessionService, multiDeviceBroadcastService,
            mentionParser, null);
    }

    public GroupChatExecutionEventHandler(ByaiMessageMapper messageMapper, GroupChatEventPublisher eventPublisher) {
        this(messageMapper, eventPublisher, null, null, null, null, null, null, null, null, null, null, null);
    }

    public GroupChatExecutionEventHandler(ByaiMessageMapper messageMapper, GroupChatEventPublisher eventPublisher,
        SequenceService sequenceService) {
        this(messageMapper, eventPublisher, sequenceService, null, null, null, null, null, null, null, null, null,
            null);
    }

    public GroupChatExecutionEventHandler(ByaiMessageMapper messageMapper, GroupChatEventPublisher eventPublisher,
        SequenceService sequenceService, ByaiGroupChatExecutionMapper executionMapper) {
        this(messageMapper, eventPublisher, sequenceService, executionMapper, null, null, null, null, null, null, null,
            null, null);
    }

    @Transactional
    public boolean handle(Long groupSessionId, Long sourceMessageId, Long replyToMessageId, Long targetAgentId,
        JSONObject event) {
        return handle((ByaiGroupChatExecution) null, groupSessionId, sourceMessageId, replyToMessageId,
            targetAgentId, event);
    }

    private boolean handle(ByaiGroupChatExecution execution, Long groupSessionId, Long sourceMessageId,
        Long replyToMessageId, Long targetAgentId, JSONObject event) {
        String key = executionKey(groupSessionId, sourceMessageId, targetAgentId);
        if (execution != null && execution.getAnswerMessageId() != null) {
            completedExecutions.put(key, Boolean.TRUE);
            extractors.remove(key);
            return false;
        }
        if (completedExecutions.containsKey(key)) {
            return false;
        }
        GroupChatFinalAnswerExtractor extractor = extractors.computeIfAbsent(key,
            ignored -> new GroupChatFinalAnswerExtractor());
        String content = extractor.accept(event);
        if (GroupChatFinalAnswerExtractor.isTerminal(event)
            && "appStreamResponse".equalsIgnoreCase(eventType(event))) {
            content = extractor.finish();
        }
        if (content == null) {
            if ("error".equalsIgnoreCase(eventType(event))) {
                completedExecutions.put(key, Boolean.TRUE);
                publishFailure(groupSessionId, sourceMessageId, targetAgentId, event);
            }
            return false;
        }
        if (completedExecutions.putIfAbsent(key, Boolean.TRUE) != null) {
            return false;
        }
        try {
            GroupChatAgentMention mentions = mentionParser == null
                ? new GroupChatAgentMention(content, List.of()) : mentionParser.parse(groupSessionId, targetAgentId, content);
            content = mentions.normalizedContent();
            long messageId = sequenceService == null ? System.currentTimeMillis() : sequenceService.nextVal();
            ByaiMessage message = new ByaiMessage();
            message.setId(messageId);
            message.setMessageId(messageId);
            message.setSessionId(groupSessionId);
            message.setMessageRef(sourceMessageId);
            message.setMessageContent(content);
            message.setCreatorId(targetAgentId);
            message.setCreatorName(event == null ? null : event.getString("agentName"));
            message.setUsage(2);
            message.setIsComplete(true);
            message.setCreateTime(new Date());
            message.setUpdateTime(new Date());
            Map<String, Object> metadata = new HashMap<>();
            metadata.put("scene", "GROUP_CHAT");
            metadata.put("targetAgentId", targetAgentId);
            metadata.put("sourceMessageId", sourceMessageId);
            metadata.put("replyToMessageId", sourceMessageId);
            metadata.put("resourceList", mentions.resourceList());
            message.setMetadata(JSON.toJSONString(metadata));
            messageMapper.insert(message);
            if (mentionService != null) {
                mentionService.indexHumanMentions(groupSessionId, messageId, targetAgentId, null,
                    mentions.resourceList());
            }
            if (execution != null) {
                execution.setAnswerMessageId(messageId);
            }
            JSONObject payload = buildMessageCreatedPayload(groupSessionId, sourceMessageId, targetAgentId, event,
                message, content, mentions.resourceList());
            publishProjectionAfterCommit(key, groupSessionId, payload, execution, mentions.resourceList());
            return true;
        }
        catch (RuntimeException error) {
            completedExecutions.remove(key);
            throw error;
        }
    }

    private JSONObject buildMessageCreatedPayload(Long groupSessionId, Long sourceMessageId, Long targetAgentId,
        JSONObject event, ByaiMessage message, String content, List<ResourceVo> resourceList) {
        JSONObject payload = new JSONObject();
        payload.put("type", "GROUP_CHAT_EVENT");
        payload.put("event", "MESSAGE_CREATED");
        payload.put("sessionId", String.valueOf(groupSessionId));
        payload.put("messageId", String.valueOf(message.getMessageId()));
        payload.put("messageRef", message.getMessageRef());
        payload.put("sourceMessageId", sourceMessageId);
        payload.put("replyToMessageId", message.getMessageRef());
        payload.put("replyTo", buildReplySummary(groupSessionId, message.getMessageRef()));
        payload.put("targetAgentId", targetAgentId);
        String agentName = event == null ? null : event.getString("agentName");
        if (agentName == null && resourceService != null && targetAgentId != null) {
            SsResource resource = resourceService.findById(targetAgentId);
            agentName = resource == null ? null : resource.getResourceName();
        }
        payload.put("creatorId", targetAgentId);
        payload.put("creatorName", agentName);
        Map<String, Object> speaker = new HashMap<>();
        speaker.put("type", "AGENT");
        speaker.put("agentId", targetAgentId == null ? null : String.valueOf(targetAgentId));
        speaker.put("agentName", agentName);
        speaker.put("displayName", agentName);
        payload.put("speaker", speaker);
        payload.put("content", content);
        payload.put("resourceList", resourceList);
        return payload;
    }

    private void publishProjectionAfterCommit(String key, Long groupSessionId, JSONObject payload,
        ByaiGroupChatExecution execution, List<ResourceVo> resourceList) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCompletion(int status) {
                    if (status == TransactionSynchronization.STATUS_COMMITTED) {
                        extractors.remove(key);
                        eventPublisher.publish(groupSessionId, payload, null);
                        scheduleAgentMentions(execution, resourceList);
                    }
                    else {
                        completedExecutions.remove(key);
                    }
                }
            });
            return;
        }
        extractors.remove(key);
        eventPublisher.publish(groupSessionId, payload, null);
        scheduleAgentMentions(execution, resourceList);
    }

    private void scheduleAgentMentions(ByaiGroupChatExecution parent, List<ResourceVo> resourceList) {
        if (executionCoordinator == null || parent == null || resourceList == null) {
            return;
        }
        for (ResourceVo resource : resourceList) {
            if (resource != null && resource.getResourceType() == AgentMetaEnum.DIG_EMPLOYEE) {
                executionCoordinator.enqueueChild(parent, Long.valueOf(resource.getResourceId()));
            }
        }
    }

    @Transactional
    public boolean handle(Long executionId, Long groupSessionId, Long sourceMessageId, Long replyToMessageId,
        Long targetAgentId, JSONObject event) {
        if (executionMapper != null && executionId != null && event != null) {
            String eventId = event.getString("event_id");
            if (eventId == null) {
                eventId = event.getString("stream_id");
            }
            if (eventId != null && executionMapper.insertEventIfAbsent(executionId, eventId, eventType(event)) == 0) {
                return false;
            }
        }
        ByaiGroupChatExecution execution = executionMapper == null || executionId == null
            ? null : executionMapper.selectById(executionId);
        if (execution != null) {
            String disposition = resolveDisposition(execution, event);
            if ("TASK".equals(disposition)) {
                broadcastTaskStream(execution, event);
                String key = executionKey(groupSessionId, sourceMessageId, targetAgentId);
                GroupChatFinalAnswerExtractor extractor = extractors.computeIfAbsent(key,
                    ignored -> new GroupChatFinalAnswerExtractor());
                extractor.accept(event);
                if (isTurnTerminal(event)) {
                    GroupChatAgentMention mentions = parseMentions(execution, extractor.finish());
                    Long taskAnswerMessageId = persistTaskAnswer(execution, mentions, event);
                    scheduleAgentMentions(execution, mentions.resourceList());
                    extractors.remove(key);
                    taskService.updateTurnStatus(execution.getCandidateSessionId(),
                        "error".equalsIgnoreCase(eventType(event)) ? "FAILED" : "WAITING_USER");
                    if ("error".equalsIgnoreCase(eventType(event))) {
                        executionMapper.markFailed(executionId, event.getString("error_code"),
                            event.getString("content"), new Date());
                    }
                    else {
                        executionMapper.markSucceeded(executionId, taskAnswerMessageId, new Date());
                    }
                }
                return false;
            }
            if ("UNKNOWN".equals(disposition)) {
                // 保留当前 turn 的最终正文，terminal 时若文件仍异常可直接按 CHAT 投影。
                extractors.computeIfAbsent(executionKey(groupSessionId, sourceMessageId, targetAgentId),
                    ignored -> new GroupChatFinalAnswerExtractor()).accept(event);
                return false;
            }
        }
        boolean handled = handle(execution, groupSessionId, sourceMessageId, replyToMessageId, targetAgentId, event);
        if (executionMapper != null && executionId != null) {
            if (handled) {
                executionMapper.markSucceeded(executionId,
                    execution == null ? null : execution.getAnswerMessageId(), new Date());
            } else if ("error".equalsIgnoreCase(eventType(event))) {
                executionMapper.markFailed(executionId, event.getString("error_code"),
                    event.getString("content"), new Date());
            }
        }
        return handled;
    }

    private String resolveDisposition(ByaiGroupChatExecution execution, JSONObject event) {
        String current = execution.getDisposition() == null ? "UNKNOWN" : execution.getDisposition();
        if (!"UNKNOWN".equals(current) || dispositionReader == null || userService == null) {
            return current;
        }
        Users initiator = userService.findById(execution.getInitiatorUserId());
        GroupChatDisposition disposition = initiator == null ? null : dispositionReader.read(initiator.getUserCode(),
            execution.getCandidateSessionId(), execution.getExecutionId());
        if (disposition != null) {
            if ("TASK".equals(disposition.getKind())) {
                taskService.promote(execution, disposition.getTaskName(), disposition.getAckText());
            }
            else if (executionMapper.decideDisposition(execution.getExecutionId(), "CHAT", null, null,
                new Date()) == 1) {
                if (candidateSessionService != null) {
                    candidateSessionService.hideChatCandidate(execution.getCandidateSessionId());
                }
            }
            return disposition.getKind();
        }
        if (GroupChatFinalAnswerExtractor.isTerminal(event)) {
            executionMapper.decideDisposition(execution.getExecutionId(), "CHAT", null, null, new Date());
            if (candidateSessionService != null) {
                candidateSessionService.hideChatCandidate(execution.getCandidateSessionId());
            }
            return "CHAT";
        }
        return "UNKNOWN";
    }

    private GroupChatAgentMention parseMentions(ByaiGroupChatExecution execution, String content) {
        return mentionParser == null ? new GroupChatAgentMention(content, List.of())
            : mentionParser.parse(execution.getGroupSessionId(), execution.getTargetAgentId(), content);
    }

    private Long persistTaskAnswer(ByaiGroupChatExecution execution, GroupChatAgentMention mentions,
        JSONObject event) {
        String content = mentions.normalizedContent();
        if (content == null || execution.getAnswerMessageId() != null) {
            return execution.getAnswerMessageId();
        }
        long messageId = sequenceService == null ? System.currentTimeMillis() : sequenceService.nextVal();
        ByaiMessage message = new ByaiMessage();
        message.setId(messageId);
        message.setMessageId(messageId);
        message.setSessionId(execution.getCandidateSessionId());
        ByaiMessage source = messageMapper.selectByMessageId(execution.getSourceMessageId());
        message.setProjectId(source == null ? null : source.getProjectId());
        message.setMessageContent(content);
        message.setCreatorId(execution.getTargetAgentId());
        message.setCreatorName(event == null ? null : event.getString("agentName"));
        message.setUsage(2);
        message.setIsComplete(true);
        Map<String, Object> metadata = new HashMap<>();
        metadata.put("scene", "GROUP_TASK");
        metadata.put("dispatchId", execution.getExecutionId());
        metadata.put("resourceList", mentions.resourceList());
        message.setMetadata(JSON.toJSONString(metadata));
        message.setCreateTime(new Date());
        message.setUpdateTime(new Date());
        messageMapper.insert(message);
        return messageId;
    }

    private void broadcastTaskStream(ByaiGroupChatExecution execution, JSONObject event) {
        if (multiDeviceBroadcastService == null || event == null
            || "_dispositionPoll".equals(eventType(event))) {
            return;
        }
        JSONObject payload = new JSONObject(event);
        JSONObject metadata = payload.getJSONObject("metadata");
        if (metadata == null) {
            metadata = new JSONObject();
            payload.put("metadata", metadata);
        }
        metadata.put("taskId", String.valueOf(execution.getCandidateSessionId()));
        multiDeviceBroadcastService.broadcastRawEvent(execution.getInitiatorUserId(),
            execution.getCandidateSessionId(), payload, null);
    }

    private void publishFailure(Long groupSessionId, Long sourceMessageId, Long targetAgentId, JSONObject event) {
        JSONObject payload = new JSONObject();
        payload.put("type", "GROUP_CHAT_EVENT");
        payload.put("event", "EXECUTION_FAILED");
        payload.put("sessionId", String.valueOf(groupSessionId));
        payload.put("sourceMessageId", sourceMessageId);
        payload.put("targetAgentId", targetAgentId);
        payload.put("error", event == null ? null : event.getString("content"));
        eventPublisher.publish(groupSessionId, payload, null);
    }

    private Map<String, Object> buildReplySummary(Long sessionId, Long messageId) {
        if (messageId == null) {
            return null;
        }
        ByaiMessage referenced = messageMapper.selectByMessageId(messageId);
        if (referenced == null || !sessionId.equals(referenced.getSessionId())) {
            return null;
        }
        Map<String, Object> reply = new HashMap<>();
        reply.put("messageId", referenced.getMessageId());
        reply.put("content", referenced.getMessageContent());
        reply.put("role", Integer.valueOf(1).equals(referenced.getUsage()) ? "USER" : "ASSISTANT");
        Map<String, Object> speaker = new HashMap<>();
        speaker.put("type", Integer.valueOf(1).equals(referenced.getUsage()) ? "USER" : "AGENT");
        speaker.put("displayName", referenced.getCreatorName());
        reply.put("speaker", speaker);
        return reply;
    }

    private String executionKey(Long groupSessionId, Long sourceMessageId, Long targetAgentId) {
        return String.valueOf(groupSessionId) + ":" + sourceMessageId + ":" + targetAgentId;
    }

    private String eventType(JSONObject event) {
        if (event == null) {
            return null;
        }
        String type = event.getString("event_type");
        return type == null ? event.getString("event") : type;
    }

    private boolean isTurnTerminal(JSONObject event) {
        String type = eventType(event);
        return "appStreamResponse".equalsIgnoreCase(type) || "error".equalsIgnoreCase(type);
    }
}
