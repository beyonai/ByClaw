package com.iwhalecloud.byai.state.domain.groupchat.application;

import jakarta.annotation.PreDestroy;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

import org.apache.commons.lang3.StringUtils;
import org.springframework.context.annotation.Lazy;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import com.iwhalecloud.byai.gateway.sandbox.service.SandboxUserContextRunner;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatExecution;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTurn;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatRecallStop;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatExecutionMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatRecallMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTurnMapper;
import com.iwhalecloud.byai.state.application.service.chat.AssistantChatApplicationService;
import com.iwhalecloud.byai.state.domain.chat.dto.ChatRuntimeState;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatInfo;
import com.iwhalecloud.byai.state.domain.chat.dto.StopChatDto;
import com.iwhalecloud.byai.state.domain.chat.service.ChatGatewaySendGuard.Lease;
import com.iwhalecloud.byai.state.domain.chat.service.ChatRuntimeStateService;
import com.iwhalecloud.byai.state.domain.chat.service.RunningOutputStreamRegistry;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatSessionSendGate;
import lombok.extern.slf4j.Slf4j;

/** 撤回的业务状态原子提交；远端停止在独立发送锁下补偿，不持有群/任务锁。 */
@Slf4j
@Service
public class GroupChatRecallCancellationService {
    private final ByaiGroupChatRecallMapper recalls;
    private final ByaiGroupChatTurnMapper turns;
    private final ByaiGroupChatExecutionMapper executions;
    private final GroupChatTaskService tasks;
    private final GroupChatSessionSendGate gate;
    private final ChatRuntimeStateService runtime;
    private final RunningOutputStreamRegistry registry;
    private final AssistantChatApplicationService chat;
    private final UserService users;
    private final SandboxUserContextRunner userContext;
    private final ExecutorService workers = new ThreadPoolExecutor(2, 2, 0L, TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<>(128));
    private final Set<Long> submitted = ConcurrentHashMap.newKeySet();
    private long cursor;

    public GroupChatRecallCancellationService(ByaiGroupChatRecallMapper recalls, ByaiGroupChatTurnMapper turns,
        ByaiGroupChatExecutionMapper executions, @Lazy GroupChatTaskService tasks, GroupChatSessionSendGate gate,
        ChatRuntimeStateService runtime, RunningOutputStreamRegistry registry,
        @Lazy AssistantChatApplicationService chat, UserService users, SandboxUserContextRunner userContext) {
        this.recalls = recalls;
        this.turns = turns;
        this.executions = executions;
        this.tasks = tasks;
        this.gate = gate;
        this.runtime = runtime;
        this.registry = registry;
        this.chat = chat;
        this.users = users;
        this.userContext = userContext;
    }

    /** 调用方必须持有群行锁，保证与入队、任务提升和发布形成稳定的先后顺序。 */
    public void cancel(Long groupId, Long messageId) {
        List<ByaiGroupChatExecution> all = new ArrayList<>(recalls.executions(groupId));
        all.addAll(recalls.turns(groupId));
        List<ByaiGroupChatExecution> affected = descendants(all, messageId);
        Set<Long> sessions = new HashSet<>();
        for (ByaiGroupChatExecution selected : affected) {
            sessions.add(selected.getCandidateSessionId());
            if (recalls.isRecalled(selected.getExecutionId())) continue;
            // 调度也锁 anchor -> turn；重新读取 trace，覆盖绑定运行态与撤回同时发生的窗口。
            ByaiGroupChatExecution anchor = executions.selectForUpdateByCandidateSessionId(selected.getCandidateSessionId());
            ByaiGroupChatExecution current = selected instanceof ByaiGroupChatTurn
                ? turns.selectForUpdateById(selected.getExecutionId()) : anchor;
            if (current == null) throw new IllegalStateException("Recall execution disappeared");
            ByaiGroupChatTask task = tasks.cancelForRecall(current.getCandidateSessionId(), current.getExecutionId());
            ByaiGroupChatRecallStop stop = new ByaiGroupChatRecallStop();
            stop.setExecutionId(current.getExecutionId());
            stop.setSessionId(current.getCandidateSessionId());
            stop.setInitiatorUserId(current.getInitiatorUserId());
            stop.setTraceId("RUNNING".equals(current.getStatus()) ? current.getTraceId() : null);
            stop.setTaskOwned(task != null);
            stop.setStatus((task != null && "RUNNING".equals(task.getTurnStatus())) || ("RUNNING".equals(current.getStatus())
                && StringUtils.isNotBlank(current.getTraceId())) ? "PENDING" : "DONE");
            recalls.insertStop(stop);
            if (current instanceof ByaiGroupChatTurn) recalls.cancelTurn(current.getExecutionId());
            else recalls.cancelExecution(current.getExecutionId());
        }
        // 重复撤回也唤醒未完成的补偿，失败记录由扫描器持续恢复。
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() { sessions.forEach(GroupChatRecallCancellationService.this::submit); }
        });
    }

    static List<ByaiGroupChatExecution> descendants(List<ByaiGroupChatExecution> all, Long messageId) {
        Set<Long> ids = new HashSet<>();
        boolean changed;
        do {
            changed = false;
            for (ByaiGroupChatExecution execution : all) {
                Long trigger = execution instanceof ByaiGroupChatTurn
                    ? ((ByaiGroupChatTurn) execution).getTriggerMessageId() : execution.getSourceMessageId();
                Long parent = execution instanceof ByaiGroupChatTurn
                    ? ((ByaiGroupChatTurn) execution).getParentTurnId() : execution.getParentExecutionId();
                if (Objects.equals(messageId, trigger) || (parent != null && ids.contains(parent))) {
                    changed |= ids.add(execution.getExecutionId());
                }
            }
        } while (changed);
        return all.stream().filter(execution -> ids.contains(execution.getExecutionId())).toList();
    }

    /** 调用方持有独立发送锁；失败直接抛出，既保留 PENDING，也阻止新发送越过未完成 STOP。 */
    public void stopPending(Long sessionId) {
        for (ByaiGroupChatRecallStop stop : recalls.pending(sessionId)) {
            ChatRuntimeState state = runtime.get(sessionId);
            RunningChatInfo running = registry.getRunning(sessionId);
            String trace = state != null && ("RUNNING".equals(state.getStatus()) || "HANDOFF_REQUESTED".equals(state.getStatus()))
                ? state.getTraceId() : running != null && Boolean.TRUE.equals(running.getRunning()) ? running.getTraceId() : null;
            ByaiGroupChatTurn currentTurn = trace == null ? null : turns.selectByTrace(trace);
            // ACTIVE 任务的私有续聊属于原任务；同会话中其他群轮次仍有独立的 trace/dispatch。
            boolean belongs = trace == null ? (StringUtils.isNotBlank(stop.getTraceId()) || stop.isTaskOwned())
                : Objects.equals(trace, stop.getTraceId()) || (stop.isTaskOwned() && currentTurn == null);
            if (belongs) {
                StopChatDto request = new StopChatDto();
                request.setSessionId(sessionId);
                request.setTraceId(trace == null ? stop.getTraceId() : trace);
                if (state != null && Objects.equals(trace, state.getTraceId())) {
                    request.setMessageId(state.getModelAnswerMessageId());
                    request.setClientRequestId(state.getClientRequestId());
                    if (state.getAssistantChatDto() != null) {
                        request.setAgentId(state.getAssistantChatDto().getAgentId());
                        request.setAgentCode(state.getAssistantChatDto().getAgentCode());
                        request.setLaneId(state.getAssistantChatDto().getLaneId());
                    }
                } else if (running != null) {
                    request.setMessageId(running.getModelAnswerMessageId());
                    request.setAgentId(running.getAgentId());
                    request.setAgentCode(running.getAgentCode());
                    request.setLaneId(running.getLaneId());
                    request.setClientRequestId(running.getClientRequestId());
                }
                userContext.runAsUser(users.findById(stop.getInitiatorUserId()).getUserCode(),
                    () -> chat.stopChatForRecall(request));
            }
            recalls.finishStop(stop.getExecutionId());
        }
    }

    @Scheduled(fixedDelayString = "${byclaw.group-chat.recall-retry-ms:5000}")
    public void recover() {
        List<Long> sessions = recalls.pendingSessions(cursor, 100);
        cursor = sessions.isEmpty() ? 0 : sessions.get(sessions.size() - 1);
        sessions.forEach(this::submit);
    }

    private void submit(Long sessionId) {
        if (!submitted.add(sessionId)) return;
        try {
            workers.execute(() -> {
                try (Lease lease = gate.acquire(sessionId)) {
                    stopPending(sessionId);
                } catch (Exception error) {
                    log.warn("撤回停止待重试, sessionId={}", sessionId, error);
                } finally {
                    submitted.remove(sessionId);
                }
            });
        } catch (RejectedExecutionException error) {
            submitted.remove(sessionId);
            log.warn("撤回停止队列已满，等待扫描恢复, sessionId={}", sessionId);
        }
    }

    @PreDestroy
    public void close() { workers.shutdownNow(); }
}
