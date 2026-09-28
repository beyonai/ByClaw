package com.iwhalecloud.byai.state.domain.groupchat.infrastructure;

import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Component;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatExecution;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTurn;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatExecutionMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatRecallMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTurnMapper;
import com.iwhalecloud.byai.state.domain.chat.service.ChatGatewaySendGuard;
import com.iwhalecloud.byai.state.domain.chat.service.ChatProcessContext;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatRecallCancellationService;

/** 每次出站查持久化屏障，防止准备期间或沙箱重试期间撤回后继续发送。 */
@Component
public class GroupChatRecallSendGuard implements ChatGatewaySendGuard {
    private final ByaiGroupChatExecutionMapper executions;
    private final ByaiGroupChatTurnMapper turns;
    private final ByaiGroupChatTaskMapper tasks;
    private final ByaiGroupChatRecallMapper recalls;
    private final GroupChatSessionSendGate gate;
    private final GroupChatRecallCancellationService cancellations;

    public GroupChatRecallSendGuard(ByaiGroupChatExecutionMapper executions, ByaiGroupChatTurnMapper turns,
        ByaiGroupChatTaskMapper tasks, ByaiGroupChatRecallMapper recalls, GroupChatSessionSendGate gate,
        @Lazy GroupChatRecallCancellationService cancellations) {
        this.executions = executions;
        this.turns = turns;
        this.tasks = tasks;
        this.recalls = recalls;
        this.gate = gate;
        this.cancellations = cancellations;
    }

    @Override
    public Lease open(ChatProcessContext context) throws Exception {
        if (context == null || context.getSessionId() == null
            || executions.selectByCandidateSessionId(context.getSessionId()) == null) return () -> { };
        Lease lease = gate.acquire(context.getSessionId());
        try {
            cancellations.stopPending(context.getSessionId());
            beforeSend(context);
            return lease;
        } catch (Exception error) {
            lease.close();
            throw error;
        }
    }

    @Override
    public void beforeSend(ChatProcessContext context) {
        if (context == null || context.getSessionId() == null) return;
        ByaiGroupChatTurn turn = context.getTraceId() == null ? null : turns.selectByTrace(context.getTraceId());
        if (turn != null) {
            if (recalls.isRecalled(turn.getExecutionId())) throw recalled();
            return;
        }
        ByaiGroupChatExecution execution = executions.selectByCandidateSessionId(context.getSessionId());
        if (execution == null) return;
        ByaiGroupChatTask task = tasks.selectById(context.getSessionId());
        if ((task != null && "CANCELLED".equals(task.getStatus())) || recalls.isRecalled(execution.getExecutionId())) {
            throw recalled();
        }
    }

    private IllegalStateException recalled() {
        return new IllegalStateException("原消息已撤回，相关执行已取消");
    }
}
