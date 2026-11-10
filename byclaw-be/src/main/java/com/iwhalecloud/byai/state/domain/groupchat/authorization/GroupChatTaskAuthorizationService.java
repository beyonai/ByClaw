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
        requireInitiator(task);
        return task;
    }

    private void requireInitiator(ByaiGroupChatTask task) {
        groupAuthorizationService.requireCurrentUserMember(task.getGroupSessionId());
        if (!task.getInitiatorUserId().equals(CurrentUserHolder.getCurrentUserId())) {
            throw new IllegalArgumentException(I18nUtil.get("groupchat.task.privateAccessDenied"));
        }
    }

    /** 通用聊天与旧单聊入口按持久化会话来源核验私聊读取权限。 */
    public void requireDirectRead(Long sessionId) {
        if (sessionId == null) return;
        ByaiGroupChatTask owner = taskMapper.selectDirectOwner(sessionId);
        if (owner != null) requireInitiator(owner);
    }

    public void requireDeletableSession(Long sessionId) {
        if (sessionId != null && taskMapper.selectDirectOwner(sessionId) != null) {
            throw new IllegalArgumentException(I18nUtil.get("groupchat.task.privateDeleteDenied"));
        }
    }

    /** 按消息 ID 编辑/删除前，同样检查当前可写私聊以及发起人与员工权限。 */
    public void requireDirectMessageWrite(Long sessionId) {
        if (sessionId == null || taskMapper.selectDirectOwner(sessionId) == null) return;
        ByaiGroupChatTask task = taskMapper.selectById(sessionId);
        if (task == null || !"PRIVATE".equals(task.getStatus())) {
            throw new IllegalArgumentException(I18nUtil.get("groupchat.task.privateHistoryReadOnly"));
        }
        requirePrivateAgent(task, task.getTargetAgentId());
    }

    /** 私聊由原发起人与固定的群员工继续处理，不能借任务接手权限切换身份。 */
    public void requirePrivateAgent(ByaiGroupChatTask task, Long agentId) {
        requireInitiator(task);
        if (!"PRIVATE".equals(task.getStatus()) || !task.getTargetAgentId().equals(agentId)) {
            throw new IllegalArgumentException(I18nUtil.get("groupchat.task.agentDenied"));
        }
        requireAuthorizedGroupAgent(task.getGroupSessionId(), agentId);
        // 已经绑定时以绑定为准；首次打开前也只允许最早的历史私聊接受写入。
        ByaiGroupChatTask canonical = taskMapper.selectBoundDirect(task.getGroupSessionId(), task.getInitiatorUserId(), agentId);
        if (canonical == null) {
            canonical = taskMapper.selectEarliestPrivate(task.getGroupSessionId(), task.getInitiatorUserId(), agentId);
        }
        if (canonical == null || !task.getTaskSessionId().equals(canonical.getTaskSessionId())) {
            throw new IllegalArgumentException(I18nUtil.get("groupchat.task.privateHistoryReadOnly"));
        }
    }

    /** 接手只改变本轮执行者，任务归属与公开发布身份始终保留最初 Agent。 */
    public ByaiGroupChatTask requireActiveAgent(Long taskId, Long agentId) {
        ByaiGroupChatTask task = requireInitiator(taskId);
        if (!"ACTIVE".equals(task.getStatus())) {
            throw new IllegalArgumentException(I18nUtil.get("groupchat.task.newTurnDenied"));
        }
        requireAuthorizedGroupAgent(task.getGroupSessionId(), agentId);
        return task;
    }

    private void requireAuthorizedGroupAgent(Long groupId, Long agentId) {
        if (agentId == null || memberService.findSessionMember(groupId, MemObjType.AGENT.name(), agentId) == null
            || resourceService.findById(agentId) == null
            || !resourceAuthService.getAuthContextBo().isAuthResourceId(agentId)) {
            throw new IllegalArgumentException(I18nUtil.get("groupchat.task.agentDenied"));
        }
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
