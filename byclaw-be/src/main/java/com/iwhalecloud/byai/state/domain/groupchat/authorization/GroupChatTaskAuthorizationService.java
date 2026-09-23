package com.iwhalecloud.byai.state.domain.groupchat.authorization;

import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper;
import com.iwhalecloud.byai.state.domain.session.enums.UserRole;
import com.iwhalecloud.byai.state.domain.session.enums.MemObjType;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceAuthContextService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;

/** 集中约束任务卡片可见性与未发布任务内容访问权限。 */
@Service
public class GroupChatTaskAuthorizationService {
    private final ByaiGroupChatTaskMapper taskMapper;
    private final GroupChatAuthorizationService groupAuthorizationService;
    private final SessionMemberService memberService;
    private final ResourceAuthContextService resourceAuthService;
    private final SsResourceService resourceService;

    public GroupChatTaskAuthorizationService(ByaiGroupChatTaskMapper taskMapper,
        GroupChatAuthorizationService groupAuthorizationService, SessionMemberService memberService,
        ResourceAuthContextService resourceAuthService, SsResourceService resourceService) {
        this.taskMapper = taskMapper;
        this.groupAuthorizationService = groupAuthorizationService;
        this.memberService = memberService;
        this.resourceAuthService = resourceAuthService;
        this.resourceService = resourceService;
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

    /** 接手只改变本轮执行者，任务归属与公开发布身份始终保留最初 Agent。 */
    public ByaiGroupChatTask requireActiveAgent(Long taskId, Long agentId) {
        ByaiGroupChatTask task = requireInitiator(taskId);
        if (!"ACTIVE".equals(task.getStatus())) {
            throw new IllegalArgumentException("Group task does not accept a new turn");
        }
        if (agentId == null
            || memberService.findSessionMember(task.getGroupSessionId(), MemObjType.AGENT.name(), agentId) == null
            || resourceService.findById(agentId) == null
            || !resourceAuthService.getAuthContextBo().isAuthResourceId(agentId)) {
            throw new IllegalArgumentException("Agent is not an authorized group member");
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
