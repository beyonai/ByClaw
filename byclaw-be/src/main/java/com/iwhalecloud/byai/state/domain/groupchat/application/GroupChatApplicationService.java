package com.iwhalecloud.byai.state.domain.groupchat.application;

import java.util.ArrayList;
import java.util.Comparator;
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
    private GroupChatTopicService topicService;
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
    private WorkgroupTemplateService workgroupTemplateService;
    @Autowired
    private GroupWorkAssistantService groupWorkAssistantService;

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
        projectRequest.setDescription(request.getGoal());
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
        Set<Long> agentIds = new LinkedHashSet<>();
        if (request.getAgentIds() != null) agentIds.addAll(request.getAgentIds());
        if (request.getTemplateId() != null) {
            agentIds.addAll(workgroupTemplateService.resolveResourceIds(request.getTemplateId(),
                request.getExpectedTemplateVersion()));
        }
        Long workAssistantId = groupWorkAssistantService.resolveResourceId();
        if (workAssistantId != null) agentIds.add(workAssistantId);
        if (!agentIds.isEmpty()) {
            agentIds.forEach(id -> addMember(members, session.getSessionId(), MemObjType.AGENT.name(), id,
                UserRole.MEMBER.name()));
        }
        memberService.batchSave(members);
        initializeMemberPermissions(session.getSessionId());
        GroupChatDetailResponse response = new GroupChatDetailResponse();
        response.setSession(session);
        response.setMembers(members);
        if (settingsService != null) response.setSettings(settingsService.settings(session.getSessionId()));
        return response;
    }

    /** 仅在建群事务中开启两项成员权限，存量群及后续手动关闭的设置保持不变。 */
    private void initializeMemberPermissions(Long sessionId) {
        for (String code : List.of(GroupChatAuthorizationService.MEMBER_INVITE_USER,
            GroupChatAuthorizationService.MEMBER_ADD_AGENT)) {
            ByaiSessionExt ext = new ByaiSessionExt();
            ext.setExtId(sequenceService.nextVal());
            ext.setSessionId(sessionId);
            ext.setExtParamCode(code);
            ext.setExtParamName(code);
            ext.setExtParamValue(Boolean.TRUE.toString());
            sessionExtService.save(ext);
        }
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
        topicService.persistMessage(message);
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
        event.put("topicId", String.valueOf(message.getTopicId()));
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
        boolean systemEvent = Integer.valueOf(5).equals(referenced.getUsage());
        reply.put("usage", referenced.getUsage());
        reply.put("role", systemEvent ? "event" : Integer.valueOf(1).equals(referenced.getUsage()) ? "USER" : "ASSISTANT");
        Map<String, Object> speaker = new HashMap<>();
        speaker.put("type", systemEvent ? "system" : Integer.valueOf(1).equals(referenced.getUsage()) ? "USER" : "AGENT");
        speaker.put("displayName", systemEvent ? "系统" : referenced.getCreatorName());
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
        recordMemberEvent(group, member, invitationService.validatedInviterId(sessionId, token), "MEMBER_INVITED");
        return member;
    }

    @Transactional(rollbackFor = Exception.class)
    public ByaiSessionMember invite(Long sessionId, String type, Long memberId) {
        sessionService.lockById(sessionId);
        authorizationService.requireInvite(sessionId, type);
        ByaiSession session = authorizationService.requireGroup(sessionId);
        if (!MemObjType.isValid(type) || memberId == null) {
            throw new IllegalArgumentException("Invalid group member");
        }
        if (memberService.findSessionMember(sessionId, type, memberId) != null) {
            throw new IllegalArgumentException("Member already exists");
        }
        ByaiSessionMember member = insertMember(session, type, memberId);
        recordMemberEvent(session, member, CurrentUserHolder.getCurrentUserId(), "MEMBER_INVITED");
        return member;
    }

    /** 批量添加在一个事务内完成，任意成员或授权失败时整批回滚。 */
    @Transactional(rollbackFor = Exception.class)
    public List<ByaiSessionMember> inviteBatch(Long sessionId, String type, List<Long> memberIds) {
        sessionService.lockById(sessionId);
        authorizationService.requireInvite(sessionId, type);
        ByaiSession session = authorizationService.requireGroup(sessionId);
        if (!MemObjType.isValid(type) || memberIds == null || memberIds.isEmpty()
            || memberIds.stream().anyMatch(id -> id == null || id <= 0)) {
            throw new IllegalArgumentException("Invalid group member");
        }
        List<Long> distinctIds = memberIds.stream().distinct().toList();
        // 全部检查通过后才开始写入，保持与原单成员接口相同的重复成员规则。
        for (Long memberId : distinctIds) {
            if (memberService.findSessionMember(sessionId, type, memberId) != null) {
                throw new IllegalArgumentException("Member already exists");
            }
        }
        List<ByaiSessionMember> result = new ArrayList<>();
        for (Long memberId : distinctIds) {
            ByaiSessionMember member = insertMember(session, type, memberId);
            recordMemberEvent(session, member, CurrentUserHolder.getCurrentUserId(), "MEMBER_INVITED");
            result.add(member);
        }
        return result;
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
        if (MemObjType.AGENT.name().equals(type)) {
            // 新增数字员工后，群内所有真人成员都应立即获得其使用权限；复用授权服务的幂等补授权逻辑。
            List<Long> userIds = memberService.findSessionMembers(session.getSessionId(), MemObjType.USER.name(), null)
                .stream().map(ByaiSessionMember::getMemObjId).distinct().toList();
            for (Long userId : userIds) {
                authApplicationService.grantDigitalEmployeesToUser(List.of(memberId), userId);
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
        ByaiSession group = authorizationService.requireGroup(sessionId);
        memberService.deleteMember(target.getByaiSessionMemberId());
        recordMemberEvent(group, target, CurrentUserHolder.getCurrentUserId(), "MEMBER_REMOVED");
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
        if (UserRole.ADMIN.name().equals(role) && !role.equals(target.getUserRole())) {
            recordAdminAppointment(sessionId, target);
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
        if (target == null || Objects.equals(current.getMemObjId(), newOwnerUserId)) {
            throw new IllegalArgumentException("New owner must be another group member");
        }
        recordAdminAppointment(sessionId, current);
        current.setUserRole(UserRole.ADMIN.name());
        target.setUserRole(UserRole.OWNER.name());
        memberService.updateById(current);
        memberService.updateById(target);
    }

    private String adminAppointmentKey(ByaiSessionMember member) {
        // 使用成员记录 ID，退群再加入不会继承上次任命的顺位。
        return "group_admin_since_" + member.getByaiSessionMemberId();
    }

    private void recordAdminAppointment(Long sessionId, ByaiSessionMember member) {
        String code = adminAppointmentKey(member);
        ByaiSessionExt ext = sessionExtService.findOneByExtParamCode(sessionId, code);
        boolean create = ext == null;
        if (create) {
            ext = new ByaiSessionExt();
            ext.setExtId(sequenceService.nextVal());
            ext.setSessionId(sessionId);
            ext.setExtParamCode(code);
            ext.setExtParamName(code);
        }
        ext.setExtParamValue(String.valueOf(System.currentTimeMillis()));
        if (create) sessionExtService.save(ext);
        else sessionExtService.update(ext);
    }

    private long joinedAt(ByaiSessionMember member) {
        return member.getCreateTime() == null ? Long.MAX_VALUE : member.getCreateTime().getTime();
    }

    private long adminAppointmentTime(Long sessionId, ByaiSessionMember member) {
        ByaiSessionExt ext = sessionExtService.findOneByExtParamCode(sessionId, adminAppointmentKey(member));
        if (ext != null) {
            try {
                return Long.parseLong(ext.getExtParamValue());
            } catch (NumberFormatException ignored) {
                // 存量数据没有可用任命时间时，按入群顺序兜底。
            }
        }
        return joinedAt(member);
    }

    @Transactional
    public void leave(Long sessionId) {
        sessionService.lockById(sessionId);
        ByaiSessionMember current = authorizationService.requireCurrentUserMember(sessionId);
        JSONObject ownershipEvent = new JSONObject();
        if (UserRole.OWNER.name().equals(current.getUserRole())) {
            // 在同一群锁和事务内交接后退出，避免并发退群留下无群主的工作组。
            // 管理员按任命时间，普通成员按入群时间；时间相同再按成员记录 ID 排序。
            Map<Long, Long> appointmentTimes = new HashMap<>();
            ByaiSessionMember successor = memberService.findOrderedGroupMembers(sessionId).stream()
                .filter(member -> MemObjType.USER.name().equals(member.getMemObjType()))
                .filter(member -> !Objects.equals(current.getMemObjId(), member.getMemObjId()))
                .min(Comparator
                    .comparingInt((ByaiSessionMember member) -> UserRole.ADMIN.name().equals(member.getUserRole()) ? 0 : 1)
                    .thenComparingLong(member -> UserRole.ADMIN.name().equals(member.getUserRole())
                        ? appointmentTimes.computeIfAbsent(member.getByaiSessionMemberId(),
                            id -> adminAppointmentTime(sessionId, member))
                        : joinedAt(member))
                    .thenComparing(ByaiSessionMember::getByaiSessionMemberId))
                .orElse(null);
            if (successor == null) {
                // 保留群主审计记录，复用解散用例停止任务并通知在线设备。
                settingsService.dissolve(sessionId);
                return;
            }
            ByaiSessionMember update = new ByaiSessionMember();
            update.setByaiSessionMemberId(successor.getByaiSessionMemberId());
            update.setUserRole(UserRole.OWNER.name());
            memberService.updateById(update);
            ByaiSession group = sessionService.findById(sessionId);
            ownershipEvent.put("type", "GROUP_CHAT_EVENT");
            ownershipEvent.put("event", "OWNERSHIP_TRANSFERRED");
            ownershipEvent.put("eventId", String.valueOf(sequenceService.nextVal()));
            ownershipEvent.put("sessionId", String.valueOf(sessionId));
            ownershipEvent.put("recipientUserId", String.valueOf(successor.getMemObjId()));
            ownershipEvent.put("groupName", group == null ? "工作组" : group.getSessionName());
        }
        ByaiSession group = authorizationService.requireGroup(sessionId);
        memberService.deleteMember(current.getByaiSessionMemberId());
        recordMemberEvent(group, current, current.getMemObjId(), "MEMBER_LEFT");
        if (!ownershipEvent.isEmpty()) {
            publishAfterCommit(sessionId, ownershipEvent);
        }
    }

    /** 成员事实和展示文案一起入库，名称快照不受后续改名或退群影响。 */
    private void recordMemberEvent(ByaiSession group, ByaiSessionMember member, Long operatorId, String eventType) {
        String memberName = memberDisplayName(member);
        ByaiSessionMember operator = Objects.equals(operatorId, member.getMemObjId())
            && MemObjType.USER.name().equals(member.getMemObjType()) ? member
            : memberService.findSessionMember(group.getSessionId(), MemObjType.USER.name(), operatorId);
        if (operator == null) {
            operator = new ByaiSessionMember();
            operator.setMemObjId(operatorId);
            operator.setMemObjType(MemObjType.USER.name());
        }
        String operatorName = memberDisplayName(operator);
        String content = switch (eventType) {
            case "MEMBER_INVITED" -> operatorName + " 邀请 " + memberName + " 加入工作组";
            case "MEMBER_LEFT" -> memberName + " 离开了工作组";
            case "MEMBER_REMOVED" -> operatorName + " 将 " + memberName + " 移出工作组";
            default -> throw new IllegalArgumentException("Unsupported membership event");
        };
        JSONObject detail = new JSONObject();
        detail.put("eventType", eventType);
        detail.put("operatorId", String.valueOf(operatorId));
        detail.put("operatorName", operatorName);
        detail.put("memberId", String.valueOf(member.getMemObjId()));
        detail.put("memberType", member.getMemObjType());
        detail.put("memberName", memberName);
        JSONObject metadata = new JSONObject();
        metadata.put("scene", "GROUP_CHAT");
        metadata.put("kind", "SYSTEM_EVENT");
        metadata.put("systemEvent", detail);
        Long messageId = sequenceService.nextVal();
        Date now = new Date();
        ByaiMessage message = new ByaiMessage();
        message.setId(messageId);
        message.setMessageId(messageId);
        message.setSessionId(group.getSessionId());
        message.setProjectId(group.getProjectId());
        message.setEnterpriseId(group.getEnterpriseId());
        message.setCreatorId(operatorId);
        message.setCreatorName(operatorName);
        message.setUsage(5);
        message.setRole("event");
        message.setMessageContent(content);
        message.setMetadata(metadata.toJSONString());
        message.setIsComplete(true);
        message.setCreateTime(now);
        message.setUpdateTime(now);
        messageMapper.insert(message);

        JSONObject membership = new JSONObject();
        membership.put("type", "GROUP_CHAT_EVENT");
        membership.put("event", "MEMBER_INVITED".equals(eventType) ? "MEMBER_ADDED" : "MEMBER_REMOVED");
        membership.put("sessionId", String.valueOf(group.getSessionId()));
        publishAfterCommit(group.getSessionId(), membership);
        JSONObject event = new JSONObject();
        event.put("type", "GROUP_CHAT_EVENT");
        event.put("event", "MESSAGE_CREATED");
        event.put("sessionId", String.valueOf(group.getSessionId()));
        event.put("messageId", String.valueOf(messageId));
        event.put("usage", 5);
        event.put("kind", "SYSTEM_EVENT");
        event.put("role", "event");
        event.put("content", content);
        event.put("createdAt", now.getTime());
        event.put("creatorId", String.valueOf(operatorId));
        event.put("creatorName", operatorName);
        event.put("speaker", Map.of("type", "system", "displayName", "系统"));
        event.put("systemEvent", detail);
        publishAfterCommit(group.getSessionId(), event);
    }

    private String memberDisplayName(ByaiSessionMember member) {
        if (member.getMemName() != null && !member.getMemName().isBlank()) return member.getMemName();
        if (MemObjType.USER.name().equals(member.getMemObjType()) && userService != null) {
            Users user = userService.findById(member.getMemObjId());
            if (user != null && user.getUserName() != null && !user.getUserName().isBlank()) return user.getUserName();
        }
        if (MemObjType.AGENT.name().equals(member.getMemObjType()) && resourceService != null) {
            SsResource resource = resourceService.findById(member.getMemObjId());
            if (resource != null && resource.getResourceName() != null && !resource.getResourceName().isBlank()) {
                return resource.getResourceName();
            }
        }
        return String.valueOf(member.getMemObjId());
    }

    /** 事务提交前不发送成员或消息事件，避免回滚后前端出现不存在的历史。 */
    private void publishAfterCommit(Long sessionId, JSONObject event) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    eventPublisher.publish(sessionId, event, null);
                }
            });
        }
        else {
            eventPublisher.publish(sessionId, event, null);
        }
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
