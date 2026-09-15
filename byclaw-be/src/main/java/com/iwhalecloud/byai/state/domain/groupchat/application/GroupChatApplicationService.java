package com.iwhalecloud.byai.state.domain.groupchat.application;

import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.constants.devloop.MemberRole;
import com.iwhalecloud.byai.manager.application.service.devloop.ProjectApplicationService;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatSettingsRequest;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectDTO;
import com.iwhalecloud.byai.manager.entity.devloop.Project;

import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import com.iwhalecloud.byai.state.domain.ws.model.ChatMessage;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import org.springframework.transaction.annotation.Transactional;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatCreateRequest;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatDetailResponse;
import com.iwhalecloud.byai.state.domain.session.enums.MemObjType;
import com.iwhalecloud.byai.state.domain.session.enums.SessionType;
import com.iwhalecloud.byai.state.domain.session.enums.UserRole;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectMemberService;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionExt;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.state.domain.session.service.SessionExtService;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatExecutionCoordinator;
import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;
import com.iwhalecloud.byai.state.domain.chat.model.MessageResourceDto;

/** 群聊资源创建和成员管理用例。 */
@Service
public class GroupChatApplicationService {
    @Autowired
    private UserService userService;
    @Autowired
    private AuthApplicationService authApplicationService;
    @Autowired
    private GroupChatSettingsService settingsService;
    @Autowired
    private SsResourceService resourceService;
    @Autowired
    private GroupChatInvitationService invitationService;
    private final SessionService sessionService;
    private final SequenceService sequenceService;
    private final GroupChatAuthorizationService authorizationService;
    private final SessionMemberService memberService;
    private final ProjectApplicationService projectApplicationService;
    private final ProjectMemberService projectMemberService;
    private final ByaiMessageMapper messageMapper;
    private final GroupChatExecutionCoordinator executionCoordinator;
    private final GroupChatEventPublisher eventPublisher;
    private final SessionExtService sessionExtService;
    private final GroupChatMentionService mentionService;

    @Autowired
    public GroupChatApplicationService(SessionService sessionService, SequenceService sequenceService,
        GroupChatAuthorizationService authorizationService, SessionMemberService memberService,
        ProjectApplicationService projectApplicationService, ProjectMemberService projectMemberService, ByaiMessageMapper messageMapper,
        GroupChatExecutionCoordinator executionCoordinator, GroupChatEventPublisher eventPublisher,
        SessionExtService sessionExtService, GroupChatMentionService mentionService) {
        this.sessionService = sessionService;
        this.sequenceService = sequenceService;
        this.authorizationService = authorizationService;
        this.memberService = memberService;
        this.projectApplicationService = projectApplicationService;
        this.projectMemberService = projectMemberService;
        this.messageMapper = messageMapper;
        this.executionCoordinator = executionCoordinator;
        this.eventPublisher = eventPublisher;
        this.sessionExtService = sessionExtService;
        this.mentionService = mentionService;
    }

    public GroupChatApplicationService(SessionService sessionService, SequenceService sequenceService,
        GroupChatAuthorizationService authorizationService, SessionMemberService memberService,
        ProjectApplicationService projectApplicationService, ProjectMemberService projectMemberService, ByaiMessageMapper messageMapper,
        GroupChatExecutionCoordinator executionCoordinator, GroupChatEventPublisher eventPublisher,
        SessionExtService sessionExtService) {
        this(sessionService, sequenceService, authorizationService, memberService, projectApplicationService,
            projectMemberService, messageMapper, executionCoordinator, eventPublisher, sessionExtService, null);
    }

    @Transactional
    public GroupChatDetailResponse create(GroupChatCreateRequest request) {
        Long operatorId = CurrentUserHolder.getCurrentUserId();
        if (operatorId == null || operatorId <= 0) {
            throw new IllegalArgumentException("Login required");
        }
        // 复用项目创建用例，云盘、工作目录和项目 owner 均使用现有初始化流程。
        ProjectDTO projectRequest = new ProjectDTO();
        projectRequest.setProjectName(request.getName());
        Project project = projectApplicationService.createProject(projectRequest);
        Set<Long> userIds = new LinkedHashSet<>();
        if (request.getUserIds() != null) {
            userIds.addAll(request.getUserIds());
        }
        userIds.remove(operatorId);
        projectMemberService.addMembers(project.getProjectId(), new ArrayList<>(userIds), MemberRole.MEMBER);
        ByaiSession session = new ByaiSession();
        session.setSessionId(sequenceService.nextVal());
        session.setProjectId(project.getProjectId());
        session.setSessionName(project.getProjectName());
        session.setSessionType(SessionType.HS_AS.getCode());
        session.setCreatorId(operatorId);
        session.setEnterpriseId(CurrentUserHolder.getEnterpriseId());
        session.setCreateTime(new Date());
        session.setUpdateTime(new Date());
        sessionService.save(session);

        ArrayList<ByaiSessionMember> members = new ArrayList<>();
        // OWNER 是群管理员权限的上位角色，同时保留转让群主和退出群聊的既有规则。
        addMember(members, session.getSessionId(), MemObjType.USER.name(), operatorId, UserRole.OWNER.name());
        userIds.forEach(id -> addMember(members, session.getSessionId(), MemObjType.USER.name(), id,
            UserRole.MEMBER.name()));
        if (request.getAgentIds() != null) {
            request.getAgentIds().forEach(id -> addMember(members, session.getSessionId(), MemObjType.AGENT.name(), id,
                UserRole.MEMBER.name()));
        }
        memberService.batchSave(members);
        GroupChatDetailResponse response = new GroupChatDetailResponse();
        response.setSession(session);
        response.setMembers(members);
        if (settingsService != null) response.setSettings(settingsService.settings(session.getSessionId()));
        return response;
    }

    private void addMember(ArrayList<ByaiSessionMember> members, Long sessionId, String type, Long id, String role) {
        if (id == null || members.stream().anyMatch(item -> item.getMemObjType().equals(type) && item.getMemObjId().equals(id))) {
            return;
        }
        ByaiSessionMember member = new ByaiSessionMember();
        member.setByaiSessionMemberId(sequenceService.nextVal());
        member.setSessionId(sessionId);
        member.setMemObjType(type);
        member.setMemObjId(id);
        member.setUserRole(role);
        member.setCreateTime(new Date());
        member.setCreatorId(CurrentUserHolder.getCurrentUserId());
        members.add(member);
    }

    /** 接收入站群消息并持久化；Agent 委派由后续协调器消费 resourceList。 */
    @Transactional
    public Long acceptUserMessage(ChatMessage command) {
        sessionService.lockById(command.getSessionId());
        ByaiSession session = authorizationService.requireGroup(command.getSessionId());
        ByaiSessionMember sender = authorizationService.requireCurrentUserMember(session.getSessionId());
        String senderName = sender.getMemName() == null || sender.getMemName().isBlank()
            ? CurrentUserHolder.getCurrentUserName() : sender.getMemName();
        Set<Long> mentionedAgentIds = validateAndResolveMemberResources(session.getSessionId(),
            command.getResourceList());
        if (command.getClientRequestId() != null) {
            ByaiMessage existing = messageMapper.selectGroupMessageByClientRequestId(session.getSessionId(),
                command.getClientRequestId());
            if (existing != null) {
                return existing.getMessageId();
            }
        }
        Long messageId = sequenceService.nextVal();
        ByaiMessage message = new ByaiMessage();
        message.setId(messageId);
        message.setMessageId(messageId);
        message.setSessionId(session.getSessionId());
        message.setProjectId(session.getProjectId());
        message.setCreatorId(CurrentUserHolder.getCurrentUserId());
        message.setCreatorName(senderName);
        message.setMessageContent(command.getChatContent());
        if (command.getFiles() != null && !command.getFiles().isEmpty()) {
            // 与历史上下文读取的普通附件结构一致，确认后和重新进入群聊时均可恢复。
            MessageResourceDto resources = new MessageResourceDto();
            resources.setFiles(command.getFiles());
            message.setRelatedResources(JSON.toJSONString(resources));
        }
        message.setUsage(1);
        message.setMessageRef(command.getReplyToMessageId());
        Map<String, Object> metadata = new HashMap<>();
        metadata.put("scene", "GROUP_CHAT");
        metadata.put("clientRequestId", command.getClientRequestId());
        metadata.put("resourceList", command.getResourceList());
        message.setMetadata(JSON.toJSONString(metadata));
        message.setCreateTime(new Date());
        message.setUpdateTime(new Date());
        message.setIsComplete(true);
        messageMapper.insert(message);
        if (mentionService != null) {
            mentionService.indexHumanMentions(session.getSessionId(), messageId,
                CurrentUserHolder.getCurrentUserId(), CurrentUserHolder.getCurrentUserId(), command.getResourceList());
        }
        JSONObject event = new JSONObject();
        event.put("type", "GROUP_CHAT_EVENT");
        event.put("event", "MESSAGE_CREATED");
        event.put("sessionId", String.valueOf(session.getSessionId()));
        event.put("messageId", String.valueOf(messageId));
        event.put("content", command.getChatContent());
        if (command.getFiles() != null && !command.getFiles().isEmpty()) {
            event.put("files", command.getFiles());
        }
        event.put("creatorId", CurrentUserHolder.getCurrentUserId());
        event.put("creatorName", senderName);
        event.put("resourceList", command.getResourceList());
        // 与发送端请求关联，广播早于 ACK 时也能合并待发送消息。
        event.put("clientRequestId", command.getClientRequestId());
        Map<String, Object> speaker = new HashMap<>();
        speaker.put("type", "USER");
        speaker.put("displayName", senderName);
        event.put("speaker", speaker);
        event.put("replyToMessageId", command.getReplyToMessageId());
        event.put("messageRef", command.getReplyToMessageId());
        event.put("replyTo", buildReplySummary(session.getSessionId(), command.getReplyToMessageId()));
        mentionedAgentIds.forEach(agentId -> executionCoordinator.enqueue(session.getSessionId(), messageId,
            command.getReplyToMessageId(), CurrentUserHolder.getCurrentUserId(), agentId, null, messageId));
        // A rejected continuation must not leave a broadcast message whose database transaction rolled back.
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    eventPublisher.publish(session.getSessionId(), event, null);
                }
            });
        }
        else {
            eventPublisher.publish(session.getSessionId(), event, null);
        }
        return messageId;
    }

    @Transactional(readOnly = true)
    public GroupChatDetailResponse detail(Long sessionId) {
        ByaiSession session = authorizationService.requireGroup(sessionId);
        authorizationService.requireCurrentUserMember(sessionId);
        GroupChatDetailResponse response = new GroupChatDetailResponse();
        response.setSession(session);
        List<ByaiSessionMember> members = memberService.findOrderedGroupMembers(sessionId);
        for (ByaiSessionMember member : members) {
            if (MemObjType.USER.name().equals(member.getMemObjType()) && userService != null
                && (member.getMemName() == null || member.getMemName().isBlank())) {
                Users user = userService.findById(member.getMemObjId());
                if (user != null) {
                    member.setMemName(user.getUserName());
                }
            }
            else if (MemObjType.AGENT.name().equals(member.getMemObjType()) && resourceService != null) {
                SsResource agent = resourceService.findById(member.getMemObjId());
                if (agent != null) {
                    member.setMemName(agent.getResourceName());
                    member.setAvatar(agent.getAvatar());
                }
            }
        }
        response.setMembers(members);
        if (settingsService != null) response.setSettings(settingsService.settings(session.getSessionId()));
        return response;
    }

    /**
     * 群聊只接受成员类型资源。数字员工会触发委派，普通用户仅保留在消息资源信息中。
     */
    private Set<Long> validateAndResolveMemberResources(Long sessionId, List<ResourceVo> resourceList) {
        Set<Long> agentIds = new LinkedHashSet<>();
        Map<Long, String> referencedMemberTypes = new HashMap<>();
        if (resourceList == null) {
            return agentIds;
        }
        for (ResourceVo resource : resourceList) {
            if (resource == null || resource.getResourceType() == null) {
                throw new IllegalArgumentException("Invalid group member resource");
            }
            String memberType;
            if (AgentMetaEnum.DIG_EMPLOYEE.equals(resource.getResourceType())) {
                memberType = MemObjType.AGENT.name();
            }
            else if (AgentMetaEnum.HUMAN.equals(resource.getResourceType())) {
                memberType = MemObjType.USER.name();
            }
            else {
                throw new IllegalArgumentException("Unsupported group member resource type");
            }
            Long memberId = parseResourceId(resource.getResourceId());
            String existingMemberType = referencedMemberTypes.putIfAbsent(memberId, memberType);
            if (existingMemberType != null && !existingMemberType.equals(memberType)) {
                throw new IllegalArgumentException("Conflicting group member resource types");
            }
            if (memberService.findSessionMember(sessionId, memberType, memberId) == null) {
                throw new IllegalArgumentException("Referenced resource is not a group member");
            }
            if (MemObjType.AGENT.name().equals(memberType)) {
                agentIds.add(memberId);
            }
        }
        return agentIds;
    }

    private Long parseResourceId(String resourceId) {
        if (resourceId == null || resourceId.isBlank()) {
            throw new IllegalArgumentException("Invalid group member resource ID");
        }
        try {
            return Long.valueOf(resourceId);
        }
        catch (NumberFormatException exception) {
            throw new IllegalArgumentException("Invalid group member resource ID", exception);
        }
    }

    private Map<String, Object> buildReplySummary(Long sessionId, Long messageId) {
        if (messageId == null) {
            return null;
        }
        ByaiMessage referenced = messageMapper.selectByMessageId(messageId);
        if (referenced == null || !sessionId.equals(referenced.getSessionId())) {
            return null;
        }
        Map<String, Object> reply = new HashMap<>();
        reply.put("messageId", referenced.getMessageId());
        reply.put("content", referenced.getMessageContent());
        reply.put("role", Integer.valueOf(1).equals(referenced.getUsage()) ? "USER" : "ASSISTANT");
        Map<String, Object> speaker = new HashMap<>();
        speaker.put("type", Integer.valueOf(1).equals(referenced.getUsage()) ? "USER" : "AGENT");
        speaker.put("displayName", referenced.getCreatorName());
        reply.put("speaker", speaker);
        return reply;
    }

    @Transactional(rollbackFor = Exception.class)
    public ByaiSessionMember acceptInvitation(Long sessionId, String token) {
        // 与解散、开关、角色及成员写操作串行，锁后再次检查到期时间及当前权限。
        sessionService.lockById(sessionId);
        ByaiSession group = invitationService.validateForMemberInvitation(sessionId, token);
        ByaiSessionMember existing = memberService.findSessionMember(group.getSessionId(), "USER", CurrentUserHolder.getCurrentUserId());
        if (existing != null) return existing;
        ByaiSessionMember member = insertMember(group, MemObjType.USER.name(), CurrentUserHolder.getCurrentUserId());
        JSONObject event = new JSONObject();
        event.put("type", "GROUP_CHAT_EVENT");
        event.put("event", "MEMBER_ADDED");
        event.put("sessionId", String.valueOf(group.getSessionId()));
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                eventPublisher.publish(group.getSessionId(), event, null);
            }
        });
        return member;
    }

    @Transactional(rollbackFor = Exception.class)
    public ByaiSessionMember invite(Long sessionId, String type, Long memberId) {
        sessionService.lockById(sessionId);
        authorizationService.requireAdmin(sessionId);
        ByaiSession session = authorizationService.requireGroup(sessionId);
        if (!MemObjType.isValid(type) || memberId == null) {
            throw new IllegalArgumentException("Invalid group member");
        }
        if (memberService.findSessionMember(sessionId, type, memberId) != null) {
            throw new IllegalArgumentException("Member already exists");
        }
        return insertMember(session, type, memberId);
    }

    /** 两种入口在各自完成授权和重复成员检查后，共用事务内写入逻辑。 */
    private ByaiSessionMember insertMember(ByaiSession session, String type, Long memberId) {
        // 邀请真人时补齐项目成员关系；已有成员的角色不变，数字员工不加入项目成员表。
        if (MemObjType.USER.name().equals(type) && session.getProjectId() != null && !projectMemberService.isMember(session.getProjectId(), memberId)) {
            projectMemberService.addMember(session.getProjectId(), memberId, MemberRole.MEMBER);
        }
        if (MemObjType.USER.name().equals(type)) {
            // 群成员中的 AGENT 标识即数字员工 resourceId；授权与项目、群成员写入共用外层事务。
            List<Long> agentIds = memberService.findSessionMembers(session.getSessionId(), MemObjType.AGENT.name(), null)
                .stream().map(ByaiSessionMember::getMemObjId).distinct().toList();
            if (!agentIds.isEmpty()) {
                authApplicationService.grantDigitalEmployeesToUser(agentIds, memberId);
            }
        }
        ByaiSessionMember member = new ByaiSessionMember();
        member.setByaiSessionMemberId(sequenceService.nextVal());
        member.setSessionId(session.getSessionId());
        member.setMemObjType(type);
        member.setMemObjId(memberId);
        member.setUserRole(UserRole.MEMBER.name());
        member.setCreatorId(CurrentUserHolder.getCurrentUserId());
        member.setCreateTime(new Date());
        if (MemObjType.USER.name().equals(type)) {
            member.setLastReadMessageId(messageMapper.selectLatestMessageId(session.getSessionId()));
            member.setLastReadTime(new Date());
        }
        memberService.save(member);
        return member;
    }

    @Transactional
    public ByaiSession updateGroupSettings(Long sessionId, String sessionName) {
        GroupChatSettingsRequest request = new GroupChatSettingsRequest();
        request.setSessionName(sessionName);
        return settingsService.updateSettings(sessionId, request);
    }

    @Transactional
    public void remove(Long sessionId, String type, Long memberId) {
        sessionService.lockById(sessionId);
        authorizationService.requireAdmin(sessionId);
        ByaiSessionMember target = memberService.findSessionMember(sessionId, type, memberId);
        if (target == null || UserRole.OWNER.name().equals(target.getUserRole())) {
            throw new IllegalArgumentException("Group member cannot be removed");
        }
        memberService.deleteMember(target.getByaiSessionMemberId());
    }

    @Transactional
    public void changeRole(Long sessionId, String type, Long memberId, String role) {
        sessionService.lockById(sessionId);
        authorizationService.requireOwner(sessionId);
        if (!MemObjType.USER.name().equals(type) || memberId == null || (!UserRole.ADMIN.name().equals(role)
            && !UserRole.MEMBER.name().equals(role))) {
            throw new IllegalArgumentException("Invalid member role");
        }
        ByaiSessionMember target = memberService.findSessionMember(sessionId, type, memberId);
        if (target == null || UserRole.OWNER.name().equals(target.getUserRole())) {
            throw new IllegalArgumentException("Member cannot be assigned this role");
        }
        target.setUserRole(role);
        memberService.updateById(target);
    }

    @Transactional
    public void transferOwnership(Long sessionId, Long newOwnerUserId) {
        sessionService.lockById(sessionId);
        authorizationService.requireOwner(sessionId);
        ByaiSessionMember current = authorizationService.requireCurrentUserMember(sessionId);
        ByaiSessionMember target = memberService.findSessionMember(sessionId, MemObjType.USER.name(), newOwnerUserId);
        if (target == null) {
            throw new IllegalArgumentException("New owner must be a group member");
        }
        current.setUserRole(UserRole.ADMIN.name());
        target.setUserRole(UserRole.OWNER.name());
        memberService.updateById(current);
        memberService.updateById(target);
    }

    @Transactional
    public void leave(Long sessionId) {
        sessionService.lockById(sessionId);
        ByaiSessionMember current = authorizationService.requireCurrentUserMember(sessionId);
        if (UserRole.OWNER.name().equals(current.getUserRole())) {
            throw new IllegalArgumentException("Group owner must transfer ownership before leaving");
        }
        memberService.deleteMember(current.getByaiSessionMemberId());
    }

    @Transactional
    public ByaiSession createDirectSession(Long groupSessionId, Long agentId) {
        ByaiSession group = authorizationService.requireGroup(groupSessionId);
        authorizationService.requireCurrentUserMember(groupSessionId);
        if (memberService.findSessionMember(groupSessionId, MemObjType.AGENT.name(), agentId) == null) {
            throw new IllegalArgumentException("Agent is not a group member");
        }
        ByaiSession direct = new ByaiSession();
        direct.setSessionId(sequenceService.nextVal());
        direct.setParentSessionId(groupSessionId);
        direct.setProjectId(group.getProjectId());
        direct.setCreatorId(CurrentUserHolder.getCurrentUserId());
        direct.setEnterpriseId(group.getEnterpriseId());
        direct.setObjectId(agentId);
        direct.setSessionType(SessionType.H_AS.getCode());
        direct.setSessionName("Group chat direct");
        direct.setCreateTime(new Date());
        direct.setUpdateTime(new Date());
        sessionService.save(direct);
        ByaiSessionExt source = new ByaiSessionExt();
        source.setExtId(sequenceService.nextVal());
        source.setSessionId(direct.getSessionId());
        source.setExtParamCode("group_source_session_id");
        source.setExtParamValue(String.valueOf(groupSessionId));
        sessionExtService.save(source);
        ByaiSessionExt boundary = new ByaiSessionExt();
        boundary.setExtId(sequenceService.nextVal());
        boundary.setSessionId(direct.getSessionId());
        boundary.setExtParamCode("group_source_boundary_message_id");
        Long latest = messageMapper.selectBySessionId(groupSessionId).stream()
            .map(ByaiMessage::getMessageId)
            .filter(Objects::nonNull)
            .max(Long::compareTo)
            .orElse(0L);
        boundary.setExtParamValue(String.valueOf(latest));
        sessionExtService.save(boundary);
        return direct;
    }
}
