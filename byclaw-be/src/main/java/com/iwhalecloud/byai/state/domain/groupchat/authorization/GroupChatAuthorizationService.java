package com.iwhalecloud.byai.state.domain.groupchat.authorization;

import com.iwhalecloud.byai.state.domain.session.service.SessionExtService;

import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.state.domain.session.enums.MemObjType;
import com.iwhalecloud.byai.state.domain.session.enums.SessionType;
import com.iwhalecloud.byai.state.domain.session.enums.UserRole;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;

/** 集中处理群聊成员身份和角色权限。 */
@Service
public class GroupChatAuthorizationService {
    public static final String DISSOLVED_STATE = "GROUP_DISSOLVED";
    public static final String MEMBER_ADD_AGENT = "group_member_add_agent_enabled";
    public static final String MEMBER_INVITE_USER = "group_member_invite_user_enabled";
    private final SessionExtService extService;
    private final SessionService sessionService;
    private final SessionMemberService memberService;

    public GroupChatAuthorizationService(SessionService sessionService, SessionMemberService memberService, SessionExtService extService) {
        this.extService = extService;
        this.sessionService = sessionService;
        this.memberService = memberService;
    }

    public ByaiSession requireGroup(Long sessionId) {
        ByaiSession session = sessionService.findById(sessionId);
        if (session == null || !SessionType.HS_AS.getCode().equals(session.getSessionType())
            || DISSOLVED_STATE.equals(session.getState())) {
            throw new IllegalArgumentException("Group chat not found");
        }
        return session;
    }

    public ByaiSessionMember requireUserMember(Long sessionId, Long userId) {
        requireGroup(sessionId);
        ByaiSessionMember member = memberService.findSessionMember(sessionId, MemObjType.USER.name(), userId);
        if (member == null) {
            throw new IllegalArgumentException("User is not a group member");
        }
        return member;
    }

    public ByaiSessionMember requireCurrentUserMember(Long sessionId) {
        Long userId = CurrentUserHolder.getCurrentUserId();
        if (userId == null) {
            throw new IllegalArgumentException("User is not authenticated");
        }
        return requireUserMember(sessionId, userId);
    }

    public void requireAdmin(Long sessionId) {
        ByaiSessionMember member = requireCurrentUserMember(sessionId);
        if (!UserRole.OWNER.name().equals(member.getUserRole()) && !UserRole.ADMIN.name().equals(member.getUserRole())) {
            throw new IllegalArgumentException("Only group owner or administrator can modify members");
        }
    }

    /** 未配置时沿用原权限：仅群主、管理员可以添加成员。 */
    public boolean memberPermissionEnabled(Long sessionId, String code) {
        var ext = extService.findOneByExtParamCode(sessionId, code);
        return ext != null && "true".equals(ext.getExtParamValue());
    }

    public void requireInvite(Long sessionId, String type) {
        requireMemberInvite(sessionId, requireCurrentUserMember(sessionId), type);
    }

    public void requireMemberInvite(Long sessionId, ByaiSessionMember member, String type) {
        if (!MemObjType.USER.name().equals(type) && !MemObjType.AGENT.name().equals(type)) {
            throw new IllegalArgumentException("Invalid group member type");
        }
        if (UserRole.OWNER.name().equals(member.getUserRole()) || UserRole.ADMIN.name().equals(member.getUserRole())) return;
        String code = MemObjType.AGENT.name().equals(type) ? MEMBER_ADD_AGENT : MEMBER_INVITE_USER;
        if (!memberPermissionEnabled(sessionId, code)) {
            throw new IllegalArgumentException("Group member invitation is disabled");
        }
    }

    public void requireOwner(Long sessionId) {
        if (!UserRole.OWNER.name().equals(requireCurrentUserMember(sessionId).getUserRole())) {
            throw new IllegalArgumentException("Only group owner can perform this operation");
        }
    }
}
