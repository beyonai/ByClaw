package com.iwhalecloud.byai.state.domain.groupchat.authorization;

import com.iwhalecloud.byai.common.i18n.I18nUtil;

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
            throw new IllegalArgumentException(I18nUtil.get("groupchat.task.notFound"));
        }
        return task;
    }

    public ByaiGroupChatTask requireInitiator(Long taskId) {
        ByaiGroupChatTask task = requireTask(taskId);
        groupAuthorizationService.requireCurrentUserMember(task.getGroupSessionId());
        if (!task.getInitiatorUserId().equals(CurrentUserHolder.getCurrentUserId())) {
            throw new IllegalArgumentException(I18nUtil.get("groupchat.task.privateAccessDenied"));
        }
        return task;
    }

    /** 接手只改变本轮执行者，任务归属与公开发布身份始终保留最初 Agent。 */
    public ByaiGroupChatTask requireActiveAgent(Long taskId, Long agentId) {
        ByaiGroupChatTask task = requireInitiator(taskId);
        if (!"ACTIVE".equals(task.getStatus())) {
            throw new IllegalArgumentException(I18nUtil.get("groupchat.task.newTurnDenied"));
        }
        if (agentId == null
            || memberService.findSessionMember(task.getGroupSessionId(), MemObjType.AGENT.name(), agentId) == null
            || resourceService.findById(agentId) == null
            || !resourceAuthService.getAuthContextBo().isAuthResourceId(agentId)) {
            throw new IllegalArgumentException(I18nUtil.get("groupchat.task.agentDenied"));
        }
        return task;
    }

    public ByaiGroupChatTask requireCanceller(Long taskId) {
        ByaiGroupChatTask task = requireTask(taskId);
        ByaiSessionMember member = groupAuthorizationService.requireCurrentUserMember(task.getGroupSessionId());
        Long userId = CurrentUserHolder.getCurrentUserId();
        if (!task.getInitiatorUserId().equals(userId) && !UserRole.OWNER.name().equals(member.getUserRole())
            && !UserRole.ADMIN.name().equals(member.getUserRole())) {
            throw new IllegalArgumentException(I18nUtil.get("groupchat.task.cancelDenied"));
        }
        return task;
    }
}
