package com.iwhalecloud.byai.state.domain.groupchat.authorization;

import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper;
import com.iwhalecloud.byai.state.domain.session.enums.UserRole;

/** 集中约束任务卡片可见性与未发布任务内容访问权限。 */
@Service
public class GroupChatTaskAuthorizationService {
    private final ByaiGroupChatTaskMapper taskMapper;
    private final GroupChatAuthorizationService groupAuthorizationService;

    public GroupChatTaskAuthorizationService(ByaiGroupChatTaskMapper taskMapper,
        GroupChatAuthorizationService groupAuthorizationService) {
        this.taskMapper = taskMapper;
        this.groupAuthorizationService = groupAuthorizationService;
    }

    public ByaiGroupChatTask requireTask(Long taskId) {
        ByaiGroupChatTask task = taskMapper.selectById(taskId);
        if (task == null) {
            throw new IllegalArgumentException("Group task not found");
        }
        return task;
    }

    public ByaiGroupChatTask requireInitiator(Long taskId) {
        ByaiGroupChatTask task = requireTask(taskId);
        groupAuthorizationService.requireCurrentUserMember(task.getGroupSessionId());
        if (!task.getInitiatorUserId().equals(CurrentUserHolder.getCurrentUserId())) {
            throw new IllegalArgumentException("Only task initiator can access unpublished task content");
        }
        return task;
    }

    public ByaiGroupChatTask requireCanceller(Long taskId) {
        ByaiGroupChatTask task = requireTask(taskId);
        ByaiSessionMember member = groupAuthorizationService.requireCurrentUserMember(task.getGroupSessionId());
        Long userId = CurrentUserHolder.getCurrentUserId();
        if (!task.getInitiatorUserId().equals(userId) && !UserRole.OWNER.name().equals(member.getUserRole())
            && !UserRole.ADMIN.name().equals(member.getUserRole())) {
            throw new IllegalArgumentException("Task cannot be cancelled by current user");
        }
        return task;
    }
}
