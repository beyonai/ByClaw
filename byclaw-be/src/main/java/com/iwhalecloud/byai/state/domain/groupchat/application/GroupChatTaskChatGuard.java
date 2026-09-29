package com.iwhalecloud.byai.state.domain.groupchat.application;

import org.springframework.stereotype.Service;
import org.apache.commons.lang3.StringUtils;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatInfo;
import com.iwhalecloud.byai.state.domain.chat.service.RunningOutputStreamRegistry;

import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatTaskAuthorizationService;

/** 在普通聊天入口复用 task session 时补充任务权限与生命周期约束。 */
@Service
public class GroupChatTaskChatGuard {
    private final ByaiGroupChatTaskMapper taskMapper;
    private final GroupChatTaskAuthorizationService authorizationService;
    private final GroupChatTaskService taskService;
    private final RunningOutputStreamRegistry runningRegistry;

    public GroupChatTaskChatGuard(ByaiGroupChatTaskMapper taskMapper,
        GroupChatTaskAuthorizationService authorizationService, GroupChatTaskService taskService,
        RunningOutputStreamRegistry runningRegistry) {
        this.taskMapper = taskMapper;
        this.authorizationService = authorizationService;
        this.taskService = taskService;
        this.runningRegistry = runningRegistry;
    }

    public Long beforeTurn(Long sessionId, Long agentId, String requestTraceId) {
        ByaiGroupChatTask task = taskMapper.selectById(sessionId);
        if (task == null) {
            return null;
        }
        authorizationService.requireActiveAgent(sessionId, agentId);
        if (StringUtils.isNotBlank(requestTraceId)) {
            // 表单/审批续传属于已有运行，不占用新任务轮次，也不覆盖正在回答的新 trace。
            RunningChatInfo running = runningRegistry.getRunning(sessionId);
            if (running == null || !Boolean.TRUE.equals(running.getRunning())
                || !requestTraceId.equals(running.getTraceId())) {
                throw new IllegalArgumentException("Group task trace is no longer running");
            }
            return null;
        }
        Long turnId = "ACTIVE".equals(task.getStatus()) ? taskService.startTurn(sessionId) : null;
        if (turnId == null) {
            throw new IllegalArgumentException("Group task does not accept a new turn");
        }
        return turnId;
    }

    public void bindTurn(Long sessionId, Long turnId, String traceId) {
        taskService.bindTurn(sessionId, turnId, traceId);
    }

    public void failTurnStart(Long sessionId, Long turnId) {
        taskService.failTurnStart(sessionId, turnId);
    }
}
