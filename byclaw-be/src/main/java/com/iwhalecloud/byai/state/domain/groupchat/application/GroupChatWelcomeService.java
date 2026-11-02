package com.iwhalecloud.byai.state.domain.groupchat.application;

import java.util.Date;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMemberMapper;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatWelcomeResponse;

/**
 * 为本次入群原子分配一次个人欢迎资格，不发送群消息或推进已读游标。
 *
 * @author Codex
 * @since 2026-10-22
 */
@Service
public class GroupChatWelcomeService {
    private final GroupChatAuthorizationService authorization;
    private final ByaiSessionMemberMapper members;

    public GroupChatWelcomeService(GroupChatAuthorizationService authorization, ByaiSessionMemberMapper members) {
        this.authorization = authorization;
        this.members = members;
    }

    /** 校验当前登录人的群成员关系，只有首次条件更新成功的客户端获得资格。 */
    @Transactional
    public GroupChatWelcomeResponse claim(Long sessionId) {
        ByaiSessionMember member = authorization.requireCurrentUserMember(sessionId);
        Date handledAt = new Date();
        boolean granted = members.claimWelcome(member.getByaiSessionMemberId(), sessionId,
            member.getMemObjId(), handledAt) == 1;
        GroupChatWelcomeResponse response = new GroupChatWelcomeResponse();
        response.setSessionId(sessionId.toString());
        response.setMemberId(member.getByaiSessionMemberId().toString());
        response.setGranted(granted);
        response.setHandledAt(granted ? handledAt.getTime() : null);
        return response;
    }
}
