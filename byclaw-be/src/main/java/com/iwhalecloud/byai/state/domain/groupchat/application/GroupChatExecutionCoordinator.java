package com.iwhalecloud.byai.state.domain.groupchat.application;

import jakarta.annotation.PreDestroy;
import java.util.Date;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatExecution;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatExecutionMapper;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatGatewayExecutor;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

/** Legacy execution entry; new requests use persisted turns and immediate session dispatch. */
@Service
public class GroupChatExecutionCoordinator {
    @Autowired
    private GroupChatTurnCoordinator turnCoordinator;

    private final ByaiGroupChatExecutionMapper executionMapper;
    private final SequenceService sequenceService;
    private final GroupChatGatewayExecutor gatewayExecutor;
    private final GroupChatCandidateSessionService candidateSessionService;
    private final ExecutorService workers = new ThreadPoolExecutor(4, 4, 0L, TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<>(128));
    @Value("${byclaw.group-chat.scan-batch-size:100}")
    private int batchSize = 100;
    private long queuedCursor;

    public GroupChatExecutionCoordinator(ByaiGroupChatExecutionMapper executionMapper, SequenceService sequenceService,
        GroupChatGatewayExecutor gatewayExecutor, GroupChatCandidateSessionService candidateSessionService) {
        this.executionMapper = executionMapper;
        this.sequenceService = sequenceService;
        this.gatewayExecutor = gatewayExecutor;
        this.candidateSessionService = candidateSessionService;
    }

    @Transactional
    public ByaiGroupChatExecution enqueue(Long groupSessionId, Long sourceMessageId, Long replyToMessageId,
        Long initiatorUserId, Long targetAgentId, Long parentExecutionId, Long rootMessageId) {
        if (turnCoordinator != null) {
            return turnCoordinator.enqueueUser(groupSessionId, sourceMessageId, replyToMessageId, initiatorUserId, targetAgentId);
        }
        ByaiGroupChatExecution existing = executionMapper.selectBySourceAndAgent(sourceMessageId, targetAgentId);
        if (existing != null) {
            return existing;
        }
        ByaiGroupChatExecution execution = new ByaiGroupChatExecution();
        execution.setExecutionId(sequenceService.nextVal());
        execution.setGroupSessionId(groupSessionId);
        execution.setSourceMessageId(sourceMessageId);
        execution.setReplyToMessageId(replyToMessageId);
        execution.setInitiatorUserId(initiatorUserId);
        execution.setTargetAgentId(targetAgentId);
        Long candidateSessionId = candidateSessionService.create(groupSessionId, sourceMessageId, initiatorUserId,
            targetAgentId);
        execution.setCandidateSessionId(candidateSessionId);
        execution.setGatewaySessionId(String.valueOf(candidateSessionId));
        execution.setStatus("QUEUED");
        execution.setDisposition("UNKNOWN");
        execution.setParentExecutionId(parentExecutionId);
        execution.setRootMessageId(rootMessageId == null ? sourceMessageId : rootMessageId);
        execution.setTraceId(UUID.randomUUID().toString());
        execution.setAttempt(0);
        execution.setCreateTime(new Date());
        executionMapper.insert(execution);
        dispatchAfterCommit(execution);
        return execution;
    }

    @Transactional
    public ByaiGroupChatExecution enqueueChild(ByaiGroupChatExecution parent, Long targetAgentId) {
        if (parent == null || targetAgentId == null) {
            return null;
        }
        return enqueue(parent.getGroupSessionId(), parent.getSourceMessageId(), parent.getReplyToMessageId(),
            parent.getInitiatorUserId(), targetAgentId, parent.getExecutionId(), parent.getRootMessageId());
    }

    public ByaiGroupChatExecution enqueueChild(ByaiGroupChatExecution parent, Long targetAgentId,
        Long triggerId, Long publicBoundary, String content, Object resourceList) {
        if (turnCoordinator != null) {
            return turnCoordinator.enqueueAgent(parent, targetAgentId, triggerId, publicBoundary, content, resourceList);
        }
        return enqueueChild(parent, targetAgentId);
    }

    /** 扫描持久化队列，进程重启后可重新接管尚未领取的执行。 */
    @Scheduled(fixedDelayString = "${byclaw.group-chat.legacy-queue-recovery-ms:60000}")
    public void pollQueuedExecutions() {
        if (gatewayExecutor == null) {
            return;
        }
        List<ByaiGroupChatExecution> executions = executionMapper.selectQueuedPage(queuedCursor, batchSize);
        if (executions != null) {
            queuedCursor = executions.size() < batchSize ? 0 : executions.get(executions.size() - 1).getExecutionId();
            executions.forEach(this::dispatch);
        }
    }

    // RUNNING 由 Stream 路由器接管，包括 BE 重启后的执行。启动时间不能证明远端已停止，
    // 因此不得按固定时长重新发送；没有可靠租约或远端终止证据时保持原执行等待结果。

    private void dispatch(ByaiGroupChatExecution execution) {
        if (execution == null || gatewayExecutor == null) {
            return;
        }
        try {
            // Claim inside the accepted worker: a full pool must leave the legacy row QUEUED.
            workers.execute(() -> {
                if (executionMapper.claim(execution.getExecutionId(), new Date()) > 0) {
                    ByaiGroupChatExecution current = executionMapper.selectById(execution.getExecutionId());
                    if (current != null) execute(current);
                }
            });
        }
        catch (RejectedExecutionException ignored) {
            // The compatibility scan will retry the unclaimed row.
        }
    }

    private void dispatchAfterCommit(ByaiGroupChatExecution execution) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            dispatch(execution);
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                dispatch(execution);
            }
        });
    }

    @PreDestroy
    public void shutdown() { workers.shutdown(); }

    private void execute(ByaiGroupChatExecution execution) {
        try {
            gatewayExecutor.execute(execution, "/by/.sessions/" + execution.getCandidateSessionId());
        }
        catch (Exception error) {
            executionMapper.markFailed(execution.getExecutionId(), "GATEWAY_EXCEPTION", error.getMessage(), new Date());
        }
    }
}
