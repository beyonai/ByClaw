package com.iwhalecloud.byai.state.domain.groupchat.authorization;

import java.util.Objects;

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
    private final SessionService sessionService;
    private final SessionMemberService memberService;

    public GroupChatAuthorizationService(SessionService sessionService, SessionMemberService memberService) {
        this.sessionService = sessionService;
        this.memberService = memberService;
    }

    public ByaiSession requireGroup(Long sessionId) {
        ByaiSession session = sessionService.findById(sessionId);
        if (session == null || !SessionType.HS_AS.getCode().equals(session.getSessionType())) {
            throw new IllegalArgumentException("Group chat not found");
        }
        return session;
    }

    public ByaiSessionMember requireUserMember(Long sessionId, Long userId) {
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

    public void requireOwner(Long sessionId) {
        if (!UserRole.OWNER.name().equals(requireCurrentUserMember(sessionId).getUserRole())) {
            throw new IllegalArgumentException("Only group owner can perform this operation");
        }
    }
}
