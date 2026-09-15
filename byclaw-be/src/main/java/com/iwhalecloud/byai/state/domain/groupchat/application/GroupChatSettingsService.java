package com.iwhalecloud.byai.state.domain.groupchat.application;

import com.iwhalecloud.byai.state.domain.session.enums.MemObjType;

import java.util.Date;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatExecution;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionExt;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatExecutionMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatSettingsRequest;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatSettingsResponse;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import com.iwhalecloud.byai.state.domain.session.enums.SessionType;
import com.iwhalecloud.byai.state.domain.session.enums.UserRole;
import com.iwhalecloud.byai.state.domain.session.service.SessionExtService;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

import lombok.RequiredArgsConstructor;

/** 群昵称、链接加入开关与生命周期。所有写操作先锁群，再校验权限。 */
@Service
@RequiredArgsConstructor
public class GroupChatSettingsService {
    private static final String LINK_ENABLED = "group_join_link_enabled";
    private final SessionService sessionService;
    private final SessionExtService extService;
    private final SessionMemberService memberService;
    private final GroupChatAuthorizationService authorizationService;
    private final SequenceService sequenceService;
    private final ByaiGroupChatTaskMapper taskMapper;
    private final ByaiGroupChatExecutionMapper executionMapper;
    private final GroupChatEventPublisher eventPublisher;

    public GroupChatSettingsResponse settings(Long sessionId) {
        authorizationService.requireCurrentUserMember(sessionId);
        return readSettings(sessionId);
    }

    private GroupChatSettingsResponse readSettings(Long sessionId) {
        GroupChatSettingsResponse response = new GroupChatSettingsResponse();
        response.setGroupNumber(String.valueOf(sessionId));
        response.setAllowJoinByLink(enabled(sessionId, LINK_ENABLED));
        return response;
    }

    private boolean enabled(Long sessionId, String code) {
        ByaiSessionExt ext = extService.findOneByExtParamCode(sessionId, code);
        // 存量群默认允许链接加入；实际入群仍须验证邀请 token。
        return ext == null || "true".equals(ext.getExtParamValue());
    }

    @Transactional
    public ByaiSession updateSettings(Long sessionId, GroupChatSettingsRequest request) {
        ByaiSession session = lockGroup(sessionId);
        authorizationService.requireAdmin(sessionId);
        if (request == null || (request.getSessionName() == null
            && request.getAllowJoinByLink() == null)) {
            throw new IllegalArgumentException("No group settings supplied");
        }
        if (request.getSessionName() != null) {
            session.setSessionName(validateName(request.getSessionName()));
        }
        if (request.getAllowJoinByLink() != null) {
            putExt(sessionId, LINK_ENABLED, request.getAllowJoinByLink().toString());
        }
        session.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        sessionService.update(session);
        publishAfterCommit(sessionId, "SETTINGS_UPDATED");
        return session;
    }

    @Transactional
    public ByaiSessionMember updateNickname(Long sessionId, String nickname) {
        lockGroup(sessionId);
        ByaiSessionMember member = authorizationService.requireCurrentUserMember(sessionId);
        // 仅更新名称，不能把读取到的角色、计数等字段写回覆盖并发更新。
        ByaiSessionMember update = new ByaiSessionMember();
        update.setByaiSessionMemberId(member.getByaiSessionMemberId());
        update.setMemName(validateName(nickname));
        memberService.updateById(update);
        member.setMemName(update.getMemName());
        publishAfterCommit(sessionId, "MEMBER_UPDATED");
        return member;
    }

    @Transactional
    public void dissolve(Long sessionId) {
        ByaiSession session = sessionService.lockById(sessionId);
        if (session == null || !SessionType.HS_AS.getCode().equals(session.getSessionType())) {
            throw new IllegalArgumentException("Group chat not found");
        }
        ByaiSessionMember operator = memberService.findSessionMember(sessionId, MemObjType.USER.name(), requireUser());
        if (operator == null || !UserRole.OWNER.name().equals(operator.getUserRole())) {
            throw new IllegalArgumentException("Only group owner can dissolve the group");
        }
        if (GroupChatAuthorizationService.DISSOLVED_STATE.equals(session.getState())) return;
        // 先关闭执行入口；保留成员和历史数据作为审计记录，不删除关联项目/云盘。
        session.setState(GroupChatAuthorizationService.DISSOLVED_STATE);
        session.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        sessionService.update(session);
        executionMapper.update(null, new LambdaUpdateWrapper<ByaiGroupChatExecution>()
            .eq(ByaiGroupChatExecution::getGroupSessionId, sessionId)
            .in(ByaiGroupChatExecution::getStatus, "QUEUED", "RUNNING", "FAILED_RETRYABLE")
            .set(ByaiGroupChatExecution::getStatus, "FAILED")
            .set(ByaiGroupChatExecution::getErrorCode, "GROUP_DISSOLVED")
            .set(ByaiGroupChatExecution::getErrorMessage, "Group has been dissolved")
            .set(ByaiGroupChatExecution::getFinishTime, new Date()));
        taskMapper.selectByGroup(sessionId).forEach(task -> {
            if ("ACTIVE".equals(task.getStatus())) taskMapper.cancel(task.getTaskSessionId(), new Date());
        });
        publishAfterCommit(sessionId, "GROUP_DISSOLVED");
    }

    private ByaiSession lockGroup(Long sessionId) {
        sessionService.lockById(sessionId);
        return authorizationService.requireGroup(sessionId);
    }

    private Long requireUser() {
        Long userId = CurrentUserHolder.getCurrentUserId();
        if (userId == null || userId <= 0) throw new IllegalArgumentException("Login required");
        return userId;
    }

    private String validateName(String value) {
        if (value == null || value.trim().isEmpty() || value.length() > 100) {
            throw new IllegalArgumentException("Name must contain 1 to 100 characters");
        }
        return value.trim();
    }

    private void putExt(Long sessionId, String code, String value) {
        ByaiSessionExt ext = extService.findOneByExtParamCode(sessionId, code);
        if (ext == null) {
            ext = new ByaiSessionExt();
            ext.setExtId(sequenceService.nextVal());
            ext.setSessionId(sessionId);
            ext.setExtParamCode(code);
            ext.setExtParamName(code);
            ext.setExtParamValue(value);
            extService.save(ext);
        } else {
            ext.setExtParamValue(value);
            extService.update(ext);
        }
    }

    private void publishAfterCommit(Long sessionId, String name) {
        JSONObject event = new JSONObject();
        event.put("type", "GROUP_CHAT_EVENT");
        event.put("event", name);
        event.put("sessionId", String.valueOf(sessionId));
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                eventPublisher.publish(sessionId, event, null);
            }
        });
    }
}
