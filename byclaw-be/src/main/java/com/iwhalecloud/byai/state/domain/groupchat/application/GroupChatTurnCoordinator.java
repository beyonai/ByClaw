package com.iwhalecloud.byai.state.domain.groupchat.application;

import java.util.Date;

import jakarta.annotation.PreDestroy;
import java.util.Objects;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import org.springframework.stereotype.Service;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.scheduling.annotation.Scheduled;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatExecution;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTurn;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatExecutionMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTurnMapper;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.state.domain.chat.dto.ChatRuntimeState;
import com.iwhalecloud.byai.state.domain.chat.service.ChatRuntimeStateService;
import com.iwhalecloud.byai.state.domain.chat.service.ChatTurnPreparationException;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatGatewayExecutor;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

/** Coordinates immutable per-turn requests under persistent session ownership. */
@Service
public class GroupChatTurnCoordinator {
    private static final Logger log = LoggerFactory.getLogger(GroupChatTurnCoordinator.class);
    private final ByaiGroupChatTurnMapper turns;
    private final ByaiGroupChatExecutionMapper anchors;
    private final ByaiGroupChatTaskMapper tasks;
    private final ByaiMessageMapper messages;
    private final GroupChatCandidateSessionService candidates;
    private final SequenceService sequence;
    private final SessionMemberService members;
    private final SessionService sessions;
    private final UserService users;
    private final SsResourceService resources;
    private final ChatRuntimeStateService runtime;
    private final GroupChatGatewayExecutor gateway;
    private final TransactionTemplate transaction;
    private final ExecutorService workers = Executors.newCachedThreadPool();

    public GroupChatTurnCoordinator(ByaiGroupChatTurnMapper turns, ByaiGroupChatExecutionMapper anchors,
        ByaiGroupChatTaskMapper tasks, ByaiMessageMapper messages, GroupChatCandidateSessionService candidates,
        SequenceService sequence, SessionMemberService members, SessionService sessions, UserService users,
        SsResourceService resources, ChatRuntimeStateService runtime, GroupChatGatewayExecutor gateway,
        PlatformTransactionManager transactionManager) {
        this.turns = turns;
        this.anchors = anchors;
        this.tasks = tasks;
        this.messages = messages;
        this.candidates = candidates;
        this.sequence = sequence;
        this.members = members;
        this.sessions = sessions;
        this.users = users;
        this.resources = resources;
        this.runtime = runtime;
        this.gateway = gateway;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    public ByaiGroupChatTurn enqueueUser(Long group, Long source, Long reply, Long user, Long agent) {
        return transaction.execute(status -> {
            turns.lockGroup(group);
            Long root = source;
            ByaiGroupChatExecution preferred = null;
            if (reply != null) {
                ByaiMessage reference = messages.selectByMessageId(reply);
                if (reference == null || !Objects.equals(group, reference.getSessionId())) {
                    throw new IllegalArgumentException("Invalid group reply reference");
                }
                ByaiGroupChatTurn origin = turns.selectByTriggerAndAgent(reply, agent);
                if (origin == null) {
                    origin = turns.selectByPublicMessage(reply);
                }
                if (origin != null) {
                    if (!Objects.equals(user, origin.getInitiatorUserId())) {
                        throw new IllegalArgumentException("Referenced conversation belongs to another user");
                    }
                    root = origin.getRootMessageId();
                    if (Objects.equals(agent, origin.getTargetAgentId())) {
                        preferred = anchors.selectById(origin.getAnchorExecutionId());
                    }
                }
                else {
                    JSONObject metadata = metadata(reference);
                    Long taskId = metadata.getLong("taskId");
                    ByaiGroupChatTask task = taskId == null ? null : tasks.selectById(taskId);
                    ByaiGroupChatExecution anchor = task == null
                        ? anchors.selectBySourceAndAgent(reply, agent)
                        : anchors.selectByCandidateSessionId(taskId);
                    if (anchor == null) {
                        anchor = anchors.selectByPublicMessage(reply);
                    }
                    if (anchor == null || !Objects.equals(anchor.getInitiatorUserId(), user)) {
                        throw new IllegalArgumentException("Reply cannot resolve an authorized conversation");
                    }
                    root = anchor.getRootMessageId();
                    if (Objects.equals(agent, anchor.getTargetAgentId())) {
                        preferred = anchor;
                    }
                }
            }
            ByaiMessage message = messages.selectByMessageId(source);
            return enqueue(group, root, source, source, user, agent, "USER", user, message.getMessageContent(),
                metadata(message), null, 0, preferred);
        });
    }

    public ByaiGroupChatTurn enqueueAgent(ByaiGroupChatExecution parent, Long agent, Long trigger,
        Long publicBoundary, String content, Object resourceList) {
        int hop = parent instanceof ByaiGroupChatTurn ? ((ByaiGroupChatTurn) parent).getHopCount() + 1 : 1;
        if (hop > 6) {
            log.info("Group automatic delegation suppressed: parentTurnId={}, targetAgentId={}, hop={}", parent.getExecutionId(), agent, hop);
            return null;
        }
        return transaction.execute(status -> {
            turns.lockGroup(parent.getGroupSessionId());
            JSONObject metadata = new JSONObject();
            metadata.put("resourceList", resourceList);
            return enqueue(parent.getGroupSessionId(), parent.getRootMessageId(), trigger, publicBoundary,
                parent.getInitiatorUserId(), agent, "AGENT", parent.getTargetAgentId(), content, metadata,
                parent.getExecutionId(), hop, null);
        });
    }

    private ByaiGroupChatTurn enqueue(Long group, Long root, Long trigger, Long boundary, Long user, Long agent,
        String senderType, Long sender, String content, JSONObject metadata, Long parent, int hop, ByaiGroupChatExecution preferred) {
        ByaiGroupChatTurn existing = turns.selectByTriggerAndAgent(trigger, agent);
        if (existing != null) {
            return existing;
        }
        requireMembers(group, user, agent);
        ByaiGroupChatExecution anchor = preferred == null ? turns.selectAnchor(root, agent, user) : preferred;
        if (anchor == null) {
            anchor = createAnchor(group, root, trigger, boundary, user, agent);
        }
        ByaiGroupChatTask task = tasks.selectById(anchor.getCandidateSessionId());
        if (task != null && "ACTIVE".equals(task.getStatus())) {
            if ("USER".equals(senderType)) {
                throw new IllegalArgumentException("Unfinished tasks require task entry");
            }
        }
        ByaiGroupChatTurn turn = new ByaiGroupChatTurn();
        turn.setExecutionId(sequence.nextVal());
        turn.setAnchorExecutionId(anchor.getExecutionId());
        turn.setGroupSessionId(group);
        turn.setRootMessageId(root);
        turn.setSourceMessageId(boundary);
        turn.setPublicBoundaryMessageId(boundary);
        turn.setReplyToMessageId(boundary);
        turn.setTriggerMessageId(trigger);
        turn.setInitiatorUserId(user);
        turn.setTargetAgentId(agent);
        turn.setCandidateSessionId(anchor.getCandidateSessionId());
        turn.setGatewaySessionId(String.valueOf(anchor.getCandidateSessionId()));
        turn.setInputMessageId(sequence.nextVal());
        turn.setParentTurnId(parent);
        turn.setParentExecutionId(parent);
        turn.setSenderType(senderType);
        turn.setSenderId(sender);
        turn.setHopCount(hop);
        turn.setPhase("NORMAL");
        turn.setStatus("QUEUED");
        turn.setDisposition("UNKNOWN");
        turn.setCreateTime(new Date());
        turn.setAttempt(0);
        String name = "USER".equals(senderType) ? users.findById(sender).getUserName()
            : resources.findById(sender).getResourceName();
        JSONObject envelope = new JSONObject(true);
        envelope.put("原始用户需求", messages.selectByMessageId(root).getMessageContent());
        envelope.put("本次发送者类型", senderType);
        envelope.put("本次发送者ID", sender);
        envelope.put("本次发送者名称", name);
        envelope.put("本次接收者ID", agent);
        envelope.put("本次接收者名称", resources.findById(agent).getResourceName());
        envelope.put("本次消息", content);
        turn.setInputContent(envelope.toJSONString());
        mergeResources(metadata, metadata(messages.selectByMessageId(root)));
        metadata.put("scene", "GROUP_TASK");
        metadata.put("senderType", senderType);
        metadata.put("senderId", sender);
        metadata.put("senderName", name);
        metadata.put("rootMessageId", root);
        metadata.put("triggerMessageId", trigger);
        metadata.put("groupTurnId", turn.getExecutionId());
        turn.setInputMetadata(metadata.toJSONString());
        if (task != null) {
            if ("ACTIVE".equals(task.getStatus())) {
                turn.setStatus("BLOCKED"); turn.setErrorCode("ACTIVE_TASK");
            }
            else {
                turn.setPhase("ASSESSMENT");
                Long assessment = candidates.createRouting(group, boundary, user, agent);
                turn.setGatewaySessionId(String.valueOf(assessment));
                ByaiMessage published = task.getPublishMessageId() == null ? null : messages.selectByMessageId(task.getPublishMessageId());
                if (published != null) {
                    envelope.put("已完成任务的公开成果", published.getMessageContent());
                    mergeResources(metadata, metadata(published));
                    turn.setInputMetadata(metadata.toJSONString());
                    turn.setInputContent(envelope.toJSONString());
                }
            }
        }
        turns.insert(turn);
        return turn;
    }

    private ByaiGroupChatExecution createAnchor(Long group, Long root, Long trigger, Long boundary, Long user, Long agent) {
        ByaiGroupChatExecution anchor = new ByaiGroupChatExecution();
        anchor.setExecutionId(sequence.nextVal());
        anchor.setGroupSessionId(group);
        anchor.setRootMessageId(root);
        anchor.setSourceMessageId(trigger);
        anchor.setReplyToMessageId(boundary);
        anchor.setInitiatorUserId(user);
        anchor.setTargetAgentId(agent);
        anchor.setCandidateSessionId(candidates.createEmpty(group, boundary, user, agent));
        anchor.setGatewaySessionId(String.valueOf(anchor.getCandidateSessionId()));
        anchor.setStatus("CONVERSATION");
        anchor.setDisposition("UNKNOWN");
        anchor.setAttempt(0);
        anchor.setCreateTime(new Date());
        anchors.insert(anchor);
        return anchor;
    }

    public void completeAssessment(ByaiGroupChatTurn turn, String disposition) {
        // Keep the original queue position through the internal routing step;
        // Business work has not run yet.
        if ("TASK".equals(disposition)) {
            turns.lockGroup(turn.getGroupSessionId());
            ByaiGroupChatExecution anchor = createAnchor(turn.getGroupSessionId(), turn.getRootMessageId(),
                turn.getInputMessageId(), turn.getPublicBoundaryMessageId(), turn.getInitiatorUserId(), turn.getTargetAgentId());
            turn.setAnchorExecutionId(anchor.getExecutionId());
            turn.setCandidateSessionId(anchor.getCandidateSessionId());
            turn.setPhase("NORMAL");
            turn.setDisposition("UNKNOWN");
        }
        else {
            turn.setPhase("CHAT_CONTINUATION"); turn.setDisposition("CHAT");
        }
        turn.setGatewaySessionId(String.valueOf(turn.getCandidateSessionId()));
        turn.setInputMessageId(sequence.nextVal());
        turn.setStatus("QUEUED");
        turn.setTraceId(null);
        turns.resetAfterAssessment(turn);
    }

    @Scheduled(fixedDelayString = "${byclaw.group-chat.execution-poll-ms:1000}")
    public void poll() {
        for (ByaiGroupChatTurn queued : turns.selectQueuedExecutions()) {
            ByaiGroupChatTurn claimed;
            try {
                claimed = transaction.execute(status -> claim(queued));
            }
            catch (RuntimeException error) {
                log.warn("Unable to claim group turn: turnId={}", queued.getExecutionId(), error);
                continue;
            }
            if (claimed != null) {
                submit(claimed);
            }
        }
        // A crash before trace binding cannot have sent a request. The locked bind fences competing workers.
        for (ByaiGroupChatTurn running : turns.selectRunningExecutions()) {
            if (running.getTraceId() != null) {
                continue;
            }
            try {
                ByaiGroupChatTurn resumable = transaction.execute(status -> resumeUnbound(running));
                if (resumable != null) {
                    submit(resumable);
                }
            }
            catch (RuntimeException error) {
                log.warn("Unable to recover unbound group turn: turnId={}", running.getExecutionId(), error);
            }
        }
    }

    private void submit(ByaiGroupChatTurn turn) {
        workers.submit(() -> {
            try {
                gateway.executeTurn(turn);
            }
            catch (RuntimeException error) {
                log.warn("Unable to start group turn: turnId={}", turn.getExecutionId(), error);
                transaction.execute(status -> {
                    ByaiGroupChatTurn persisted = turns.selectForUpdateById(turn.getExecutionId());
                    if (persisted != null && "RUNNING".equals(persisted.getStatus())
                        && (persisted.getTraceId() == null || (isPreparationFailure(error)
                            && Objects.equals(persisted.getTraceId(), turn.getTraceId())))) {
                        turns.markFailed(turn.getExecutionId(), "START_FAILED", error.getMessage(), new Date());
                    }
                    return null;
                });
            }
        });
    }

    private boolean isPreparationFailure(Throwable error) {
        for (Throwable cause = error; cause != null; cause = cause.getCause()) {
            if (cause instanceof ChatTurnPreparationException) {
                return true;
            }
        }
        return false;
    }

    private ByaiGroupChatTurn claim(ByaiGroupChatTurn queued) {
        anchors.selectForUpdateByCandidateSessionId(queued.getCandidateSessionId());
        if (turns.selectRunningBySession(queued.getCandidateSessionId()) != null) {
            return null;
        }
        ByaiGroupChatTurn first = turns.selectFirstQueued(queued.getCandidateSessionId());
        if (first == null || !Objects.equals(first.getExecutionId(), queued.getExecutionId())) {
            return null;
        }
        if (!validateBeforeStart(first)) {
            return null;
        }
        if (turns.claim(first.getExecutionId(), new Date()) != 1) {
            return null;
        }
        first.setStatus("RUNNING");
        return first;
    }

    private ByaiGroupChatTurn resumeUnbound(ByaiGroupChatTurn snapshot) {
        anchors.selectForUpdateByCandidateSessionId(snapshot.getCandidateSessionId());
        ByaiGroupChatTurn turn = turns.selectForUpdateById(snapshot.getExecutionId());
        if (turn == null || !"RUNNING".equals(turn.getStatus()) || turn.getTraceId() != null
            || !Objects.equals(turn.getCandidateSessionId(), snapshot.getCandidateSessionId())) {
            return null;
        }
        return validateBeforeStart(turn) ? turn : null;
    }

    private boolean validateBeforeStart(ByaiGroupChatTurn first) {
        try {
            requireMembers(first.getGroupSessionId(), first.getInitiatorUserId(), first.getTargetAgentId());
        }
        catch (IllegalArgumentException error) {
            block(first, "MEMBERSHIP_CHANGED");
            return false;
        }
        ByaiSession target = sessions.findById(first.getCandidateSessionId());
        if (target == null || !Objects.equals(target.getCreatorId(), first.getInitiatorUserId())
            || !Objects.equals(target.getObjectId(), first.getTargetAgentId())) {
            block(first, "SESSION_OWNERSHIP_CHANGED");
            return false;
        }
        ByaiGroupChatTask task = tasks.selectById(first.getCandidateSessionId());
        if (task != null && "ACTIVE".equals(task.getStatus())) {
            block(first, "ACTIVE_TASK");
            return false;
        }
        if (task != null && "NORMAL".equals(first.getPhase())) {
            // A queued request may outlive promotion and publication of the preceding turn.
            Long assessment = candidates.createRouting(first.getGroupSessionId(), first.getPublicBoundaryMessageId(),
                first.getInitiatorUserId(), first.getTargetAgentId());
            first.setPhase("ASSESSMENT");
            first.setGatewaySessionId(String.valueOf(assessment));
            ByaiMessage publication = task.getPublishMessageId() == null ? null : messages.selectByMessageId(task.getPublishMessageId());
            if (publication != null) {
                JSONObject input = JSON.parseObject(first.getInputContent());
                input.put("已完成任务的公开成果", publication.getMessageContent());
                first.setInputContent(input.toJSONString());
                JSONObject displayMetadata = JSON.parseObject(first.getInputMetadata());
                mergeResources(displayMetadata, metadata(publication));
                first.setInputMetadata(displayMetadata.toJSONString());
            }
            turns.updateById(first);
        }
        if (first.getHopCount() > 6) {
            block(first, "HOP_LIMIT");
            return false;
        }
        ChatRuntimeState state = runtime.get(first.getCandidateSessionId());
        if (state != null && (ChatRuntimeState.STATUS_RUNNING.equals(state.getStatus())
            || ChatRuntimeState.STATUS_HANDOFF_REQUESTED.equals(state.getStatus()))) {
            return false;
        }
        return true;
    }

    private void block(ByaiGroupChatTurn turn, String reason) {
        turn.setStatus("BLOCKED");
        turn.setErrorCode(reason);
        turn.setFinishTime(new Date());
        turns.updateById(turn);
    }

    private void requireMembers(Long group, Long user, Long agent) {
        if (members.findSessionMember(group, "USER", user) == null
            || members.findSessionMember(group, "AGENT", agent) == null) {
            throw new IllegalArgumentException("Conversation participants are no longer group members");
        }
    }

    /** Rendering resources cover all supplied background; scheduling uses only the current trigger. */
    private void mergeResources(JSONObject target, JSONObject background) {
        Map<String, JSONObject> merged = new LinkedHashMap<>();
        for (JSONObject source : new JSONObject[] {background, target}) {
            Object resources = source.get("resourceList");
            if (resources == null) {
                continue;
            }
            JSONArray list = JSON.parseArray(JSON.toJSONString(resources));
            for (int index = 0; index < list.size(); index++) {
                JSONObject resource = list.getJSONObject(index);
                merged.put(resource.getString("resourceType") + ":" + resource.getString("resourceId"), resource);
            }
        }
        target.put("resourceList", merged.values());
    }

    @PreDestroy
    public void shutdown() {
        workers.shutdown();
    }

    private JSONObject metadata(ByaiMessage message) {
        return message.getMetadata() == null ? new JSONObject() : JSON.parseObject(message.getMetadata());
    }
}
