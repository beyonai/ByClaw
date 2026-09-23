package com.iwhalecloud.byai.state.domain.groupchat.application;

import jakarta.annotation.PreDestroy;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatExecution;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTurn;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatExecutionMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTurnMapper;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.chat.dto.ChatRuntimeState;
import com.iwhalecloud.byai.state.domain.chat.service.ChatRuntimeStateService;
import com.iwhalecloud.byai.state.domain.chat.service.GroupChatContextService;
import com.iwhalecloud.byai.state.domain.chat.service.ChatSessionReleased;
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
    private final GroupChatContextService contextService;
    private final GroupChatGatewayExecutor gateway;
    private final TransactionTemplate transaction;
    private final ExecutorService workers = new ThreadPoolExecutor(8, 8, 0L, TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<>(128));
    private final Set<Long> submitted = ConcurrentHashMap.newKeySet();
    private final TransactionTemplate dispatchTransaction;
    @Value("${byclaw.group-chat.scan-batch-size:100}")
    private int batchSize = 100;
    private long queuedCursor;
    private long unboundCursor;

    public GroupChatTurnCoordinator(ByaiGroupChatTurnMapper turns, ByaiGroupChatExecutionMapper anchors,
        ByaiGroupChatTaskMapper tasks, ByaiMessageMapper messages, GroupChatCandidateSessionService candidates,
        SequenceService sequence, SessionMemberService members, SessionService sessions, UserService users,
        SsResourceService resources, ChatRuntimeStateService runtime, GroupChatGatewayExecutor gateway,
        GroupChatContextService contextService, PlatformTransactionManager transactionManager) {
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
        this.contextService = contextService;
        this.gateway = gateway;
        this.transaction = new TransactionTemplate(transactionManager);
        this.dispatchTransaction = new TransactionTemplate(transactionManager);
        this.dispatchTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
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
                    root = origin.getRootMessageId();
                    if (Objects.equals(user, origin.getInitiatorUserId())
                        && Objects.equals(agent, origin.getTargetAgentId())) {
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
                    if (anchor == null) {
                        throw new IllegalArgumentException("Reply cannot resolve an authorized conversation");
                    }
                    root = anchor.getRootMessageId();
                    if (Objects.equals(user, anchor.getInitiatorUserId())
                        && Objects.equals(agent, anchor.getTargetAgentId())) {
                        preferred = anchor;
                    }
                }
            }
            ByaiMessage message = messages.selectByMessageId(source);
            JSONObject quoted = reply == null ? null : quotedMessage(group, reply);
            return enqueue(group, root, source, source, user, agent, "USER", user, message.getMessageContent(),
                metadata(message), null, 0, preferred, quoted);
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
                parent.getExecutionId(), hop, null, null);
        });
    }

    /** 将本轮明确引用的群消息冻结到调度快照，附件沿用群历史的安全投影。 */
    private JSONObject quotedMessage(Long group, Long reply) {
        ByaiMessage visible = messages.selectVisibleGroupMessage(group, reply);
        JSONObject quoted = new JSONObject(true);
        quoted.put("messageId", String.valueOf(reply));
        if (visible == null || Integer.valueOf(5).equals(visible.getUsage())) {
            quoted.put("unavailable", true);
            return quoted;
        }
        var projected = contextService.toMessages(List.of(visible), Map.of()).get(0);
        quoted.put("recalled", projected.isRecalled());
        quoted.put("role", projected.getRole());
        quoted.put("speaker", projected.getSpeaker());
        quoted.put("content", projected.getContent());
        quoted.put("resourceList", projected.getResourceList());
        quoted.put("attachments", projected.getAttachments());
        return quoted;
    }

    private ByaiGroupChatTurn enqueue(Long group, Long root, Long trigger, Long boundary, Long user, Long agent,
        String senderType, Long sender, String content, JSONObject metadata, Long parent, int hop,
        ByaiGroupChatExecution preferred, JSONObject quoted) {
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
                throw new GroupChatActiveTaskException(anchor.getCandidateSessionId(), agent);
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
        if (quoted != null) {
            envelope.put("本次引用消息", quoted);
        }
        // 调度快照保留完整上下文；子会话正文只使用“本次消息”，其余信息在 Gateway 出站时追加。
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
                turn.setPhase("CHAT_CONTINUATION");
                turn.setDisposition("CHAT");
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
        if ("QUEUED".equals(turn.getStatus())) {
            wakeAfterCommit(turn.getCandidateSessionId());
        }
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

    /** Normal queue progression is event driven; these bounded pages only repair missed wakeups. */
    @Scheduled(fixedDelayString = "${byclaw.group-chat.turn-recovery-ms:10000}")
    public void poll() {
        List<ByaiGroupChatTurn> queued = turns.selectQueuedPage(queuedCursor, batchSize);
        queuedCursor = queued.size() < batchSize ? 0 : queued.get(queued.size() - 1).getExecutionId();
        for (ByaiGroupChatTurn turn : queued) {
            tryDispatchSession(turn.getCandidateSessionId());
        }
        List<ByaiGroupChatTurn> unbound = turns.selectUnboundPage(unboundCursor, batchSize);
        unboundCursor = unbound.size() < batchSize ? 0 : unbound.get(unbound.size() - 1).getExecutionId();
        for (ByaiGroupChatTurn snapshot : unbound) {
            try {
                ByaiGroupChatTurn resumed = dispatchTransaction.execute(status -> resumeUnbound(snapshot));
                if (resumed != null) submit(resumed);
            }
            catch (RuntimeException error) {
                log.warn("Unable to recover unbound group turn: turnId={}", snapshot.getExecutionId(), error);
            }
        }
    }

    @EventListener
    public void onSessionReleased(ChatSessionReleased event) {
        wakeAfterCommit(event.sessionId());
    }

    /** Callbacks may still hold committed transaction resources, so dispatch always uses a fresh transaction. */
    public void wakeAfterCommit(Long sessionId) {
        Runnable wake = () -> {
            try {
                workers.execute(() -> tryDispatchSession(sessionId));
            }
            catch (RejectedExecutionException error) {
                log.debug("Group dispatch capacity exhausted; compensation will retry sessionId={}", sessionId);
            }
        };
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCommit() { wake.run(); }
            });
        }
        else wake.run();
    }

    public void tryDispatchSession(Long sessionId) {
        try {
            ByaiGroupChatTurn claimed = dispatchTransaction.execute(status -> {
                anchors.selectForUpdateByCandidateSessionId(sessionId);
                ByaiGroupChatTurn head = turns.selectFirstQueued(sessionId);
                return head == null ? null : claim(head);
            });
            if (claimed != null) submit(claimed);
        }
        catch (RuntimeException error) {
            log.warn("Unable to dispatch group session: sessionId={}", sessionId, error);
        }
    }

    private void submit(ByaiGroupChatTurn turn) {
        if (!submitted.add(turn.getExecutionId())) return;
        try {
            workers.execute(() -> {
                try {
                    gateway.executeTurn(turn);
                }
                catch (RuntimeException error) {
                    log.warn("Unable to start group turn: turnId={}", turn.getExecutionId(), error);
                    dispatchTransaction.execute(status -> {
                        ByaiGroupChatTurn persisted = turns.selectForUpdateById(turn.getExecutionId());
                        if (persisted != null && "RUNNING".equals(persisted.getStatus())
                            && (persisted.getTraceId() == null || (isPreparationFailure(error)
                                && Objects.equals(persisted.getTraceId(), turn.getTraceId())))) {
                            turns.markFailed(turn.getExecutionId(), "START_FAILED", error.getMessage(), new Date());
                            wakeAfterCommit(persisted.getCandidateSessionId());
                        }
                        return null;
                    });
                }
                finally { submitted.remove(turn.getExecutionId()); }
            });
        }
        catch (RejectedExecutionException error) {
            // No worker bound a trace; the persisted RUNNING row remains recoverable.
            submitted.remove(turn.getExecutionId());
            log.debug("Group worker capacity exhausted: turnId={}", turn.getExecutionId());
        }
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
        if ((task != null && "NORMAL".equals(first.getPhase())) || "ASSESSMENT".equals(first.getPhase())) {
            // 排队期间任务可能已结束；旧版尚未发送的评估记录也直接转为原会话追问。
            first.setPhase("CHAT_CONTINUATION");
            first.setDisposition("CHAT");
            first.setGatewaySessionId(String.valueOf(first.getCandidateSessionId()));
            ByaiMessage publication = task == null || task.getPublishMessageId() == null ? null : messages.selectByMessageId(task.getPublishMessageId());
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
        wakeAfterCommit(turn.getCandidateSessionId());
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
