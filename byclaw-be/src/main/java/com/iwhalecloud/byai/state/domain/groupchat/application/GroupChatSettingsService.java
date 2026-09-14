package com.iwhalecloud.byai.state.domain.groupchat.application;

import java.util.Date;
import java.util.List;
import java.util.Objects;
import java.util.stream.Collectors;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.iwhalecloud.byai.common.constants.devloop.MemberRole;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectMemberService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatExecution;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionExt;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatExecutionMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatJoinApplication;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatInvitationResponse;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatSettingsRequest;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatSettingsResponse;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import com.iwhalecloud.byai.state.domain.session.enums.MemObjType;
import com.iwhalecloud.byai.state.domain.session.enums.SessionType;
import com.iwhalecloud.byai.state.domain.session.enums.UserRole;
import com.iwhalecloud.byai.state.domain.session.service.SessionExtService;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

import lombok.RequiredArgsConstructor;

/** 群昵称、加入策略、入群审批与生命周期。所有写操作先锁群，再校验权限。 */
@Service
@RequiredArgsConstructor
public class GroupChatSettingsService {
    private static final String NUMBER_ENABLED = "group_join_number_enabled";
    private static final String LINK_ENABLED = "group_join_link_enabled";
    private static final String APPLICATION_PREFIX = "group_join_request_";
    private final SessionService sessionService;
    private final SessionExtService extService;
    private final SessionMemberService memberService;
    private final GroupChatAuthorizationService authorizationService;
    private final SequenceService sequenceService;
    private final ProjectMemberService projectMemberService;
    private final UserService userService;
    private final ByaiMessageMapper messageMapper;
    private final ByaiGroupChatTaskMapper taskMapper;
    private final ByaiGroupChatExecutionMapper executionMapper;
    private final GroupChatEventPublisher eventPublisher;

    public GroupChatInvitationResponse invitation(Long sessionId) {
        Long userId = requireUser();
        ByaiSession session = authorizationService.requireGroup(sessionId);
        boolean alreadyMember = memberService.findSessionMember(sessionId, MemObjType.USER.name(), userId) != null;
        boolean allowJoin = enabled(sessionId, LINK_ENABLED);
        if (!allowJoin && !alreadyMember) {
            throw new IllegalArgumentException("Joining by link is disabled");
        }
        GroupChatInvitationResponse response = new GroupChatInvitationResponse();
        response.setGroupNumber(String.valueOf(sessionId));
        response.setGroupName(session.getSessionName());
        response.setMemberCount(memberService.findSessionMembers(sessionId, null, null).size());
        response.setAllowJoinByLink(allowJoin);
        response.setAlreadyMember(alreadyMember);
        return response;
    }

    public GroupChatSettingsResponse settings(Long sessionId) {
        authorizationService.requireCurrentUserMember(sessionId);
        return readSettings(sessionId);
    }

    private GroupChatSettingsResponse readSettings(Long sessionId) {
        GroupChatSettingsResponse response = new GroupChatSettingsResponse();
        response.setGroupNumber(String.valueOf(sessionId));
        response.setAllowJoinByNumber(enabled(sessionId, NUMBER_ENABLED));
        response.setAllowJoinByLink(enabled(sessionId, LINK_ENABLED));
        return response;
    }

    private boolean enabled(Long sessionId, String code) {
        ByaiSessionExt ext = extService.findOneByExtParamCode(sessionId, code);
        // 存量群兼容链接加入；群号加入始终先审批，开关并不绕过审批。
        return ext == null || "true".equals(ext.getExtParamValue());
    }

    @Transactional
    public ByaiSession updateSettings(Long sessionId, GroupChatSettingsRequest request) {
        ByaiSession session = lockGroup(sessionId);
        authorizationService.requireAdmin(sessionId);
        if (request == null || (request.getSessionName() == null && request.getAllowJoinByNumber() == null
            && request.getAllowJoinByLink() == null)) {
            throw new IllegalArgumentException("No group settings supplied");
        }
        if (request.getSessionName() != null) {
            session.setSessionName(validateName(request.getSessionName()));
        }
        if (request.getAllowJoinByNumber() != null) {
            putExt(sessionId, NUMBER_ENABLED, request.getAllowJoinByNumber().toString());
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
    public ByaiSessionMember joinByLink(Long sessionId) {
        Long userId = requireUser();
        ByaiSession session = lockGroup(sessionId);
        ByaiSessionMember existing = memberService.findSessionMember(sessionId, MemObjType.USER.name(), userId);
        if (existing != null) return existing;
        if (!enabled(sessionId, LINK_ENABLED)) throw new IllegalArgumentException("Joining by link is disabled");
        ByaiSessionMember member = addUser(session, userId);
        finishPending(sessionId, userId, "JOINED", null);
        publishAfterCommit(sessionId, "MEMBER_ADDED");
        return member;
    }

    @Transactional
    public GroupChatJoinApplication applyByNumber(String groupNumber) {
        Long userId = requireUser();
        Long sessionId;
        try {
            if (groupNumber == null || !groupNumber.matches("[1-9][0-9]{0,18}")) throw new NumberFormatException();
            sessionId = Long.valueOf(groupNumber);
        } catch (NumberFormatException error) {
            throw new IllegalArgumentException("Invalid group number");
        }
        lockGroup(sessionId);
        ByaiSessionMember existing = memberService.findSessionMember(sessionId, MemObjType.USER.name(), userId);
        if (existing != null) {
            GroupChatJoinApplication joined = new GroupChatJoinApplication();
            joined.setSessionId(String.valueOf(sessionId));
            joined.setUserId(String.valueOf(userId));
            joined.setStatus("JOINED");
            return joined;
        }
        if (!enabled(sessionId, NUMBER_ENABLED)) throw new IllegalArgumentException("Joining by number is disabled");
        GroupChatJoinApplication application = application(sessionId, userId);
        if (application != null && "PENDING".equals(application.getStatus())) return application;
        application = new GroupChatJoinApplication();
        application.setRequestId(String.valueOf(sequenceService.nextVal()));
        application.setSessionId(String.valueOf(sessionId));
        application.setUserId(String.valueOf(userId));
        application.setUserName(CurrentUserHolder.getCurrentUserName());
        application.setStatus("PENDING");
        application.setRequestedAt(System.currentTimeMillis());
        saveApplication(sessionId, application);
        // 申请者尚不是成员，此处不向其开放群详情或消息。
        return application;
    }

    public GroupChatJoinApplication myApplication(Long sessionId) {
        Long userId = requireUser();
        // 解散后仍允许申请者查询自己申请的最终状态。
        return application(sessionId, userId);
    }

    public List<GroupChatJoinApplication> applications(Long sessionId) {
        authorizationService.requireAdmin(sessionId);
        return extService.selectBySessionId(sessionId).stream()
            .filter(ext -> ext.getExtParamCode() != null && ext.getExtParamCode().startsWith(APPLICATION_PREFIX))
            .map(ext -> JSON.parseObject(ext.getExtParamValue(), GroupChatJoinApplication.class))
            .sorted((left, right) -> Long.compare(right.getRequestedAt(), left.getRequestedAt()))
            .collect(Collectors.toList());
    }

    @Transactional
    public GroupChatJoinApplication review(Long sessionId, String requestId, Boolean approved) {
        ByaiSession session = lockGroup(sessionId);
        authorizationService.requireAdmin(sessionId);
        if (approved == null) throw new IllegalArgumentException("Approval decision is required");
        GroupChatJoinApplication application = applications(sessionId).stream()
            .filter(item -> Objects.equals(requestId, item.getRequestId())).findFirst()
            .orElseThrow(() -> new IllegalArgumentException("Join request not found"));
        String status = approved ? "APPROVED" : "REJECTED";
        if (!"PENDING".equals(application.getStatus())) {
            if (status.equals(application.getStatus())) return application;
            throw new IllegalArgumentException("Join request has already been processed");
        }
        if (approved) {
            if (!enabled(sessionId, NUMBER_ENABLED)) throw new IllegalArgumentException("Joining by number is disabled");
            addUser(session, Long.valueOf(application.getUserId()));
        }
        application.setStatus(status);
        application.setReviewerId(String.valueOf(requireUser()));
        application.setReviewedAt(System.currentTimeMillis());
        saveApplication(sessionId, application);
        if (approved) publishAfterCommit(sessionId, "MEMBER_ADDED");
        return application;
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
        extService.selectBySessionId(sessionId).stream()
            .filter(ext -> ext.getExtParamCode() != null && ext.getExtParamCode().startsWith(APPLICATION_PREFIX))
            .forEach(ext -> {
                GroupChatJoinApplication application = JSON.parseObject(ext.getExtParamValue(), GroupChatJoinApplication.class);
                if ("PENDING".equals(application.getStatus())) {
                    application.setStatus("CANCELLED");
                    application.setReviewerId(String.valueOf(requireUser()));
                    application.setReviewedAt(System.currentTimeMillis());
                    ext.setExtParamValue(JSON.toJSONString(application));
                    extService.update(ext);
                }
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

    private ByaiSessionMember addUser(ByaiSession session, Long userId) {
        ByaiSessionMember existing = memberService.findSessionMember(session.getSessionId(), MemObjType.USER.name(), userId);
        if (existing != null) return existing;
        if (userService.findById(userId) == null) throw new IllegalArgumentException("Applicant no longer exists");
        if (session.getProjectId() != null && !projectMemberService.isMember(session.getProjectId(), userId)) {
            projectMemberService.addMember(session.getProjectId(), userId, MemberRole.MEMBER);
        }
        ByaiSessionMember member = new ByaiSessionMember();
        member.setByaiSessionMemberId(sequenceService.nextVal());
        member.setSessionId(session.getSessionId());
        member.setMemObjType(MemObjType.USER.name());
        member.setMemObjId(userId);
        member.setUserRole(UserRole.MEMBER.name());
        member.setCreatorId(requireUser());
        member.setCreateTime(new Date());
        member.setLastReadMessageId(messageMapper.selectLatestMessageId(session.getSessionId()));
        member.setLastReadTime(new Date());
        memberService.save(member);
        return member;
    }

    private GroupChatJoinApplication application(Long sessionId, Long userId) {
        ByaiSessionExt ext = extService.findOneByExtParamCode(sessionId, APPLICATION_PREFIX + userId);
        return ext == null ? null : JSON.parseObject(ext.getExtParamValue(), GroupChatJoinApplication.class);
    }

    private void finishPending(Long sessionId, Long userId, String status, String reviewerId) {
        GroupChatJoinApplication application = application(sessionId, userId);
        if (application != null && "PENDING".equals(application.getStatus())) {
            application.setStatus(status);
            application.setReviewerId(reviewerId);
            application.setReviewedAt(System.currentTimeMillis());
            saveApplication(sessionId, application);
        }
    }

    private void saveApplication(Long sessionId, GroupChatJoinApplication application) {
        putExt(sessionId, APPLICATION_PREFIX + application.getUserId(), JSON.toJSONString(application));
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
