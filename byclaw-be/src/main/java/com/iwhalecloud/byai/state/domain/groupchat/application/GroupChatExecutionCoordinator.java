package com.iwhalecloud.byai.state.domain.groupchat.application;

import java.util.Date;
import java.util.UUID;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import org.springframework.stereotype.Service;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.annotation.Transactional;

import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatExecution;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatExecutionMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatGatewayExecutor;
import com.iwhaleai.byai.framework.client.GatewayClient;

/** 群聊 Agent 执行记录入口；实际 Gateway 消费可由 Redis worker 异步接管。 */
@Service
public class GroupChatExecutionCoordinator {
    private final ByaiGroupChatExecutionMapper executionMapper;
    private final SequenceService sequenceService;
    private final GroupChatGatewayExecutor gatewayExecutor;
    private final GroupChatCandidateSessionService candidateSessionService;
    private final ExecutorService workers = Executors.newCachedThreadPool();

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

    /** 扫描持久化队列，进程重启后可重新接管尚未领取的执行。 */
    @Scheduled(fixedDelayString = "${byclaw.group-chat.execution-poll-ms:1000}")
    public void pollQueuedExecutions() {
        if (gatewayExecutor == null) {
            return;
        }
        List<ByaiGroupChatExecution> executions = executionMapper.selectQueuedExecutions();
        if (executions != null) {
            executions.forEach(this::dispatch);
        }
    }

    // RUNNING 由 Stream 路由器接管，包括 BE 重启后的执行。启动时间不能证明远端已停止，
    // 因此不得按固定时长重新发送；没有可靠租约或远端终止证据时保持原执行等待结果。

    private void dispatch(ByaiGroupChatExecution execution) {
        if (execution == null || gatewayExecutor == null) {
            return;
        }
        if (executionMapper.claim(execution.getExecutionId(), new Date()) <= 0) {
            return;
        }
        workers.submit(() -> execute(execution));
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

    private void execute(ByaiGroupChatExecution execution) {
        try {
            GatewayClient.SendResponse response = gatewayExecutor.execute(execution,
                "/by/.sessions/" + execution.getCandidateSessionId());
            if (response == null || !response.isSuccess()) {
                executionMapper.markFailed(execution.getExecutionId(),
                    response == null ? "GATEWAY_EMPTY" : response.getErrorCode(),
                    response == null ? "Gateway returned no response" : response.getError(), new Date());
            }
        }
        catch (Exception error) {
            executionMapper.markFailed(execution.getExecutionId(), "GATEWAY_EXCEPTION", error.getMessage(), new Date());
        }
    }
}
