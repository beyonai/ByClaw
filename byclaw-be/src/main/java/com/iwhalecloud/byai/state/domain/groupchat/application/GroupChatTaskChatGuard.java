package com.iwhalecloud.byai.state.domain.groupchat.application;

import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatTaskAuthorizationService;

/** 在普通聊天入口复用 task session 时补充任务权限与生命周期约束。 */
@Service
public class GroupChatTaskChatGuard {
    private final ByaiGroupChatTaskMapper taskMapper;
    private final GroupChatTaskAuthorizationService authorizationService;
    private final GroupChatTaskService taskService;

    public GroupChatTaskChatGuard(ByaiGroupChatTaskMapper taskMapper,
        GroupChatTaskAuthorizationService authorizationService, GroupChatTaskService taskService) {
        this.taskMapper = taskMapper;
        this.authorizationService = authorizationService;
        this.taskService = taskService;
    }

    public boolean beforeTurn(Long sessionId) {
        ByaiGroupChatTask task = taskMapper.selectById(sessionId);
        if (task == null) {
            return false;
        }
        authorizationService.requireInitiator(sessionId);
        if (!"ACTIVE".equals(task.getStatus()) || !taskService.startTurn(sessionId)) {
            throw new IllegalArgumentException("Group task does not accept a new turn");
        }
        return true;
    }

    public void afterTurn(Long sessionId, boolean succeeded) {
        if (taskMapper.selectById(sessionId) != null) {
            taskService.updateTurnStatus(sessionId, succeeded ? "WAITING_USER" : "FAILED");
        }
    }
}
