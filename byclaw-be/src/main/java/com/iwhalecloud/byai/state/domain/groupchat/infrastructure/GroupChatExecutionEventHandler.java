package com.iwhalecloud.byai.state.domain.groupchat.infrastructure;

import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatExecution;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTurn;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTurnMapper;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatExecutionMapper;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.common.enums.MessageContentTypeEnum;
import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import com.iwhalecloud.byai.state.domain.chat.dto.ChatRuntimeState;
import com.iwhalecloud.byai.state.domain.chat.service.ChatProcessContext;
import com.iwhalecloud.byai.state.domain.chat.service.ChatRuntimeStateService;
import com.iwhalecloud.byai.state.domain.chat.service.ChatTurnPersistenceObserver;
import com.iwhalecloud.byai.state.domain.chat.service.TraceIdCodec;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatCandidateSessionService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatExecutionCoordinator;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatMentionService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTaskService;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatAgentMention;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatDisposition;
import com.iwhalecloud.byai.state.domain.message.enums.MsgStatus;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTopicService;

/** 只观察分类和已落库的子会话结果；流式聚合、快照及私有消息持久化由普通聊天链路负责。 */
@Service
public class GroupChatExecutionEventHandler implements ChatTurnPersistenceObserver {
    @Autowired
    private GroupChatTopicService topicService;
    @Autowired
    private ByaiGroupChatTurnMapper turnMapper;
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
    private final GroupChatAgentMentionParser mentionParser;
    private final GroupChatMentionService mentionService;
    private final ChatRuntimeStateService runtimeStateService;

    public GroupChatExecutionEventHandler(ByaiMessageMapper messageMapper, GroupChatEventPublisher eventPublisher,
        SequenceService sequenceService, ByaiGroupChatExecutionMapper executionMapper,
        GroupChatExecutionCoordinator executionCoordinator, SsResourceService resourceService,
        UserService userService, GroupChatDispositionReader dispositionReader, GroupChatTaskService taskService,
        GroupChatCandidateSessionService candidateSessionService, GroupChatAgentMentionParser mentionParser,
        GroupChatMentionService mentionService, ChatRuntimeStateService runtimeStateService) {
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
        this.mentionParser = mentionParser;
        this.mentionService = mentionService;
        this.runtimeStateService = runtimeStateService;
    }

    @Override
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void afterPersisted(ChatProcessContext context) {
        if (context == null || context.sessionId == null || StringUtils.isBlank(context.traceId)) {
            return;
        }
        ByaiGroupChatTurn turn = turnMapper == null ? null : turnMapper.selectByTrace(context.traceId);
        if (turn != null) {
            turn = lockCurrentTurn(turn);
            if (turn != null && "RUNNING".equals(turn.getStatus()) && Objects.equals(turn.getTraceId(), context.traceId)) {
                completeInitialTurn(turn, context.modelAnswerMessageId, context.gatewayError || context.getException() != null);
            }
            return;
        }
        ByaiGroupChatExecution execution = lockLegacyExecution(context.sessionId);
        if (execution == null) {
            return;
        }
        if (Objects.equals(execution.getTraceId(), context.traceId)) {
            if ("RUNNING".equals(execution.getStatus())) {
                completeInitialTurn(execution, context.modelAnswerMessageId, context.gatewayError
                    || context.getException() != null);
            }
            return;
        }
        // 首轮执行记录保留原 trace。后续普通 turn 的旧回调不能结束已经开始的新 turn。
        ChatRuntimeState current = runtimeStateService.get(context.sessionId);
        if ("TASK".equals(execution.getDisposition()) && current != null
            && Objects.equals(current.getTraceId(), context.traceId)) {
            taskService.updateTurnStatus(context.sessionId,
                context.gatewayError || context.getException() != null ? "FAILED" : "WAITING_USER");
        }
    }

    /** 定时观察分类并补偿进程重启、持久化后回调失败；不读取或 ACK Redis Stream。 */
    @Transactional
    public void reconcile(Long candidateSessionId) {
        ByaiGroupChatExecution execution = lockLegacyExecution(candidateSessionId);
        if (execution == null || !"RUNNING".equals(execution.getStatus())) {
            return;
        }
        resolveDisposition(execution, false);
        if (!TraceIdCodec.canDecode(execution.getTraceId())) {
            return;
        }
        Long answerId = TraceIdCodec.decode(execution.getTraceId()).getModelAnswerMessageId();
        completeInitialTurn(execution, answerId, false);
    }

    @Transactional
    public void reconcileTurn(Long turnId) {
        ByaiGroupChatTurn turn = turnMapper.selectById(turnId);
        if (turn == null) { return; }
        turn = lockCurrentTurn(turn);
        if (turn == null || !"RUNNING".equals(turn.getStatus())) { return; }
        // 尚未绑定 trace 的 turn 由调度器负责恢复，观察器不能提前结束它。
        if (turn.getTraceId() == null || retireLegacyAssessment(turn)) { return; }
        resolveDisposition(turn, false);
        if (TraceIdCodec.canDecode(turn.getTraceId())) {
            completeInitialTurn(turn, TraceIdCodec.decode(turn.getTraceId()).getModelAnswerMessageId(), false);
        }
    }

    private ByaiGroupChatExecution lockLegacyExecution(Long candidateSessionId) {
        ByaiGroupChatExecution snapshot = executionMapper.selectByCandidateSessionId(candidateSessionId);
        if (snapshot == null) return null;
        topicService.lockGroup(snapshot.getGroupSessionId());
        return executionMapper.selectForUpdateByCandidateSessionId(candidateSessionId);
    }

    private ByaiGroupChatTurn lockCurrentTurn(ByaiGroupChatTurn snapshot) {
        turnMapper.lockGroup(snapshot.getGroupSessionId());
        executionMapper.selectForUpdateByCandidateSessionId(snapshot.getCandidateSessionId());
        // 普通查询可能缓存了等待锁之前的 RUNNING 状态，必须锁定读取最新 turn。
        ByaiGroupChatTurn current = turnMapper.selectForUpdateById(snapshot.getExecutionId());
        // 确认锁定的会话仍与读取快照一致，避免处理已变更的 turn。
        return current != null && Objects.equals(current.getGroupSessionId(), snapshot.getGroupSessionId())
            && Objects.equals(current.getCandidateSessionId(), snapshot.getCandidateSessionId()) ? current : null;
    }

    /** 已发送的旧版内部评估不可作为业务答复投影，也不能在升级后盲目重发。 */
    private boolean retireLegacyAssessment(ByaiGroupChatExecution execution) {
        if (execution instanceof ByaiGroupChatTurn turn && "ASSESSMENT".equals(turn.getPhase())) {
            markFailed(execution, "ASSESSMENT_RETIRED", "Routing assessment was removed; retry the group reply");
            return true;
        }
        return false;
    }

    private void completeInitialTurn(ByaiGroupChatExecution execution, Long answerId, boolean failed) {
        if (retireLegacyAssessment(execution)) { return; }
        ByaiMessage answer = answerId == null ? null : messageMapper.selectByMessageId(answerId);
        if (answer == null || !Objects.equals(answer.getSessionId(), execution instanceof ByaiGroupChatTurn
                ? Long.valueOf(execution.getGatewaySessionId()) : execution.getCandidateSessionId())
            || !Integer.valueOf(2).equals(answer.getUsage())
            || !(Boolean.TRUE.equals(answer.getIsComplete()) || MsgStatus.FINISH.getCode().equals(answer.getMsgStatus()))) {
            return;
        }
        JSONObject answerMetadata = StringUtils.isBlank(answer.getMetadata())
            ? new JSONObject() : JSON.parseObject(answer.getMetadata());
        failed = failed || answerMetadata.getBooleanValue("turnFailed");
        String disposition = resolveDisposition(execution, true);
        String finalText = finalAnswer(answer);
        GroupChatAgentMention mentions = mentionParser.parse(execution.getGroupSessionId(),
            execution.getTargetAgentId(), finalText);
        if ("TASK".equals(disposition)) {
            // 保留普通链路保存的过程结构，仅补充合法成员引用的展示信息。
            normalizeTaskMentions(execution, answer, answerMetadata);
            if (!failed) {
                scheduleAgentMentions(execution, mentions, answerId, execution.getSourceMessageId());
            }
            taskService.updateTurnStatus(execution.getCandidateSessionId(), failed ? "FAILED" : "WAITING_USER");
            if (failed) {
                markFailed(execution, "TURN_FAILED", "Task turn failed");
            }
            else {
                markSucceeded(execution, answerId);
            }
        }
        else if (failed || StringUtils.isBlank(mentions.normalizedContent())) {
            markFailed(execution, failed ? "TURN_FAILED" : "EMPTY_ANSWER",
                failed ? "Chat turn failed" : "Chat turn has no final answer");
            JSONObject event = new JSONObject();
            event.put("type", "GROUP_CHAT_EVENT");
            event.put("event", "EXECUTION_FAILED");
            event.put("sessionId", String.valueOf(execution.getGroupSessionId()));
            event.put("sourceMessageId", execution.getSourceMessageId());
            event.put("targetAgentId", execution.getTargetAgentId());
            publishAfterCommit(execution.getGroupSessionId(), event);
        }
        else {
            Long groupMessageId = projectChatAnswer(execution, answer, mentions);
            scheduleAgentMentions(execution, mentions, groupMessageId, groupMessageId);
            markSucceeded(execution, groupMessageId);
        }
    }

    private String resolveDisposition(ByaiGroupChatExecution execution, boolean terminal) {
        String current = StringUtils.defaultIfBlank(execution.getDisposition(), "UNKNOWN");
        if (!"UNKNOWN".equals(current)) {
            return current;
        }
        Users user = userService.findById(execution.getInitiatorUserId());
        GroupChatDisposition disposition = user == null ? null : dispositionReader.read(user.getUserCode(),
            execution instanceof ByaiGroupChatTurn ? Long.valueOf(execution.getGatewaySessionId()) : execution.getCandidateSessionId(), execution.getExecutionId());
        if (disposition == null && !terminal) {
            return current;
        }
        String kind = disposition == null ? "CHAT" : disposition.getKind();
        if ("TASK".equals(kind)) {
            taskService.promote(execution, disposition.getTaskName(), disposition.getAckText());
        }
        else {
            decideDisposition(execution, "CHAT");
            candidateSessionService.hideChatCandidate(execution.getCandidateSessionId());
        }
        execution.setDisposition(kind);
        return kind;
    }

    private void decideDisposition(ByaiGroupChatExecution execution, String kind) {
        int changed = execution instanceof ByaiGroupChatTurn
            ? turnMapper.decideDisposition(execution.getExecutionId(), kind, null, null, new Date())
            : executionMapper.decideDisposition(execution.getExecutionId(), kind, null, null, new Date());
        if (changed != 1) {
            throw new IllegalStateException("Group turn disposition changed concurrently: " + execution.getExecutionId());
        }
        execution.setDisposition(kind);
    }

    private void normalizeTaskMentions(ByaiGroupChatExecution execution, ByaiMessage answer, JSONObject metadata) {
        GroupChatAgentMention allMentions = mentionParser.parse(execution.getGroupSessionId(),
            execution.getTargetAgentId(), answer.getMessageContent());
        metadata.put("scene", "GROUP_TASK");
        metadata.put("dispatchId", execution.getExecutionId());
        metadata.put("resourceList", allMentions.resourceList());
        ByaiMessageHotDto update = new ByaiMessageHotDto();
        update.setMessageId(answer.getMessageId());
        update.setMessageContent(allMentions.normalizedContent());
        update.setMetadata(metadata.toJSONString());
        if (StringUtils.isNotBlank(answer.getMessageStruct())) {
            JSONArray segments = JSON.parseArray(answer.getMessageStruct());
            for (int i = 0; i < segments.size(); i++) {
                JSONObject segment = segments.getJSONObject(i);
                if (!isText(segment)) {
                    continue;
                }
                JSONArray choices = segment.getJSONArray("choices");
                if (choices != null && !choices.isEmpty()) {
                    JSONObject delta = choices.getJSONObject(0).getJSONObject("delta");
                    if (delta != null) {
                        delta.put("content", mentionParser.parse(execution.getGroupSessionId(),
                            execution.getTargetAgentId(), delta.getString("content")).normalizedContent());
                    }
                }
            }
            update.setMessageStruct(segments.toJSONString());
        }
        messageMapper.updateByMessageId(update);
    }

    /** 群回复仅取最后一段答案，不能将任务中间正文或工具内容拼进父群消息。 */
    static String finalAnswer(ByaiMessage answer) {
        if (StringUtils.isNotBlank(answer.getFinalContent())) {
            return answer.getFinalContent();
        }
        if (StringUtils.isBlank(answer.getMessageStruct())) {
            return answer.getMessageContent();
        }
        JSONArray segments = JSON.parseArray(answer.getMessageStruct());
        Long lastReasonSeq = null;
        if (StringUtils.isNotBlank(answer.getInferLog())) {
            JSONArray reasons = JSON.parseArray(answer.getInferLog());
            for (int i = 0; i < reasons.size(); i++) {
                Long seq = reasons.getJSONObject(i).getLong("seq");
                if (seq != null && (lastReasonSeq == null || seq > lastReasonSeq)) {
                    lastReasonSeq = seq;
                }
            }
        }
        for (int i = segments.size() - 1; i >= 0; i--) {
            JSONObject segment = segments.getJSONObject(i);
            if (isText(segment)) {
                Long seq = segment.getLong("seq");
                if (seq != null && lastReasonSeq != null && seq <= lastReasonSeq) {
                    return null;
                }
                JSONArray choices = segment.getJSONArray("choices");
                if (choices != null && !choices.isEmpty()) {
                    JSONObject delta = choices.getJSONObject(0).getJSONObject("delta");
                    if (delta != null && StringUtils.isNotBlank(delta.getString("content"))) {
                        return delta.getString("content");
                    }
                }
            }
        }
        return null;
    }

    private static boolean isText(JSONObject segment) {
        String type = segment.getString("contentType");
        return StringUtils.isBlank(type) || MessageContentTypeEnum.TEXT.getCode().equals(type) || "text".equals(type);
    }

    private Long projectChatAnswer(ByaiGroupChatExecution execution, ByaiMessage answer,
        GroupChatAgentMention mentions) {
        Long id = sequenceService.nextVal();
        ByaiMessage message = new ByaiMessage();
        message.setId(id);
        message.setMessageId(id);
        message.setSessionId(execution.getGroupSessionId());
        message.setProjectId(answer.getProjectId());
        message.setMessageRef(execution.getSourceMessageId());
        message.setMessageContent(mentions.normalizedContent());
        message.setCreatorId(execution.getTargetAgentId());
        message.setResComId(execution.getTargetAgentId());
        SsResource agent = resourceService.findById(execution.getTargetAgentId());
        message.setCreatorName(agent == null ? null : agent.getResourceName());
        message.setUsage(2);
        message.setIsComplete(true);
        message.setCreateTime(new Date());
        message.setUpdateTime(new Date());
        Map<String, Object> metadata = new HashMap<>();
        metadata.put("scene", "GROUP_CHAT");
        if (execution instanceof ByaiGroupChatTurn) {
            metadata.put("groupTurnId", execution.getExecutionId());
            metadata.put("rootMessageId", execution.getRootMessageId());
        }
        metadata.put("targetAgentId", execution.getTargetAgentId());
        metadata.put("sourceMessageId", execution.getSourceMessageId());
        metadata.put("replyToMessageId", execution.getSourceMessageId());
        metadata.put("resourceList", mentions.resourceList());
        message.setMetadata(JSON.toJSONString(metadata));
        topicService.persistMessage(message);
        mentionService.indexHumanMentions(execution.getGroupSessionId(), id, execution.getTargetAgentId(), null,
            mentions.resourceList());
        JSONObject payload = new JSONObject(metadata);
        payload.put("type", "GROUP_CHAT_EVENT");
        payload.put("event", "MESSAGE_CREATED");
        payload.put("sessionId", String.valueOf(execution.getGroupSessionId()));
        payload.put("messageId", String.valueOf(id));
        payload.put("topicId", String.valueOf(message.getTopicId()));
        payload.put("messageRef", execution.getSourceMessageId());
        payload.put("replyTo", buildReplySummary(execution));
        payload.put("creatorId", execution.getTargetAgentId());
        payload.put("creatorName", message.getCreatorName());
        Map<String, Object> speaker = new HashMap<>();
        speaker.put("type", "AGENT");
        speaker.put("agentId", String.valueOf(execution.getTargetAgentId()));
        speaker.put("agentName", message.getCreatorName());
        speaker.put("displayName", message.getCreatorName());
        payload.put("speaker", speaker);
        payload.put("content", mentions.normalizedContent());
        publishAfterCommit(execution.getGroupSessionId(), payload);
        return id;
    }

    private Map<String, Object> buildReplySummary(ByaiGroupChatExecution execution) {
        ByaiMessage source = messageMapper.selectByMessageId(execution.getSourceMessageId());
        if (source == null || !Objects.equals(source.getSessionId(), execution.getGroupSessionId())) {
            return null;
        }
        Map<String, Object> reply = new HashMap<>();
        reply.put("messageId", source.getMessageId());
        reply.put("content", source.getMessageContent());
        reply.put("role", Integer.valueOf(1).equals(source.getUsage()) ? "USER" : "ASSISTANT");
        Map<String, Object> speaker = new HashMap<>();
        speaker.put("type", Integer.valueOf(1).equals(source.getUsage()) ? "USER" : "AGENT");
        speaker.put("displayName", source.getCreatorName());
        speaker.put(Integer.valueOf(1).equals(source.getUsage()) ? "userId" : "agentId", source.getCreatorId());
        reply.put("speaker", speaker);
        return reply;
    }

    private void markSucceeded(ByaiGroupChatExecution execution, Long answerId) {
        int changed = execution instanceof ByaiGroupChatTurn
            ? turnMapper.markSucceeded(execution.getExecutionId(), answerId, new Date())
            : executionMapper.markSucceeded(execution.getExecutionId(), answerId, new Date());
        // 完成状态未取得所有权时，回滚本事务的消息、子委派和待发布事件，禁止留下重复投影。
        if (changed != 1) {
            throw new IllegalStateException("Group turn completion changed concurrently: " + execution.getExecutionId());
        }
    }

    private void markFailed(ByaiGroupChatExecution execution, String code, String message) {
        if (execution instanceof ByaiGroupChatTurn) { turnMapper.markFailed(execution.getExecutionId(), code, message, new Date()); }
        else { executionMapper.markFailed(execution.getExecutionId(), code, message, new Date()); }
    }

    private void scheduleAgentMentions(ByaiGroupChatExecution execution, GroupChatAgentMention mentions,
        Long triggerId, Long publicBoundary) {
        List<ResourceVo> resources = mentions.resourceList();
        // 子委派先在当前投影事务中登记，协调器自身在提交后才发给 Gateway，便于失败重试。
        for (ResourceVo resource : resources) {
            if (resource.getResourceType() == AgentMetaEnum.DIG_EMPLOYEE) {
                executionCoordinator.enqueueChild(execution, Long.valueOf(resource.getResourceId()),
                    triggerId, publicBoundary, mentions.normalizedContent(), resources);
            }
        }
    }

    private void publishAfterCommit(Long sessionId, JSONObject payload) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            eventPublisher.publish(sessionId, payload, null);
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                eventPublisher.publish(sessionId, payload, null);
            }
        });
    }
}
