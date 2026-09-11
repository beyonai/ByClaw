package com.iwhalecloud.byai.state.domain.groupchat.application;

import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.constants.devloop.MemberRole;
import com.iwhalecloud.byai.manager.application.service.devloop.ProjectApplicationService;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectDTO;
import com.iwhalecloud.byai.manager.entity.devloop.Project;

import org.springframework.stereotype.Service;
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

/** 群聊资源创建和成员管理用例。 */
@Service
public class GroupChatApplicationService {
    @org.springframework.beans.factory.annotation.Autowired
    private UserService userService;
    @org.springframework.beans.factory.annotation.Autowired
    private SsResourceService resourceService;
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

    @org.springframework.beans.factory.annotation.Autowired
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
    public Long acceptUserMessage(com.iwhalecloud.byai.state.domain.ws.model.ChatMessage command) {
        ByaiSession session = authorizationService.requireGroup(command.getSessionId());
        authorizationService.requireCurrentUserMember(session.getSessionId());
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
        message.setCreatorName(CurrentUserHolder.getCurrentUserName());
        message.setMessageContent(command.getChatContent());
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
        com.alibaba.fastjson.JSONObject event = new com.alibaba.fastjson.JSONObject();
        event.put("type", "GROUP_CHAT_EVENT");
        event.put("event", "MESSAGE_CREATED");
        event.put("sessionId", String.valueOf(session.getSessionId()));
        event.put("messageId", String.valueOf(messageId));
        event.put("content", command.getChatContent());
        event.put("creatorId", CurrentUserHolder.getCurrentUserId());
        event.put("creatorName", CurrentUserHolder.getCurrentUserName());
        event.put("resourceList", command.getResourceList());
        // 与发送端请求关联，广播早于 ACK 时也能合并待发送消息。
        event.put("clientRequestId", command.getClientRequestId());
        Map<String, Object> speaker = new HashMap<>();
        speaker.put("type", "USER");
        speaker.put("displayName", CurrentUserHolder.getCurrentUserName());
        event.put("speaker", speaker);
        event.put("replyToMessageId", command.getReplyToMessageId());
        event.put("messageRef", command.getReplyToMessageId());
        event.put("replyTo", buildReplySummary(session.getSessionId(), command.getReplyToMessageId()));
        eventPublisher.publish(session.getSessionId(), event, null);
        mentionedAgentIds.forEach(agentId -> executionCoordinator.enqueue(session.getSessionId(), messageId,
            command.getReplyToMessageId(), CurrentUserHolder.getCurrentUserId(), agentId, null, messageId));
        return messageId;
    }

    @Transactional(readOnly = true)
    public GroupChatDetailResponse detail(Long sessionId) {
        ByaiSession session = authorizationService.requireGroup(sessionId);
        authorizationService.requireCurrentUserMember(sessionId);
        GroupChatDetailResponse response = new GroupChatDetailResponse();
        response.setSession(session);
        java.util.List<ByaiSessionMember> members = memberService.findSessionMembers(sessionId, null, null);
        for (ByaiSessionMember member : members) {
            if (MemObjType.USER.name().equals(member.getMemObjType()) && userService != null) {
                com.iwhalecloud.byai.manager.entity.users.Users user = userService.findById(member.getMemObjId());
                if (user != null) {
                    member.setMemName(user.getUserName());
                }
            }
            else if (MemObjType.AGENT.name().equals(member.getMemObjType()) && resourceService != null) {
                com.iwhalecloud.byai.manager.entity.resource.SsResource agent = resourceService.findById(member.getMemObjId());
                if (agent != null) {
                    member.setMemName(agent.getResourceName());
                }
            }
        }
        response.setMembers(members);
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

    @Transactional
    public ByaiSessionMember invite(Long sessionId, String type, Long memberId) {
        authorizationService.requireAdmin(sessionId);
        ByaiSession session = authorizationService.requireGroup(sessionId);
        if (!MemObjType.isValid(type) || memberId == null) {
            throw new IllegalArgumentException("Invalid group member");
        }
        if (memberService.findSessionMember(sessionId, type, memberId) != null) {
            throw new IllegalArgumentException("Member already exists");
        }
        // 邀请真人时补齐项目成员关系；已有成员的角色不变，数字员工不加入项目成员表。
        if (MemObjType.USER.name().equals(type) && !projectMemberService.isMember(session.getProjectId(), memberId)) {
            projectMemberService.addMember(session.getProjectId(), memberId, MemberRole.MEMBER);
        }
        ByaiSessionMember member = new ByaiSessionMember();
        member.setByaiSessionMemberId(sequenceService.nextVal());
        member.setSessionId(sessionId);
        member.setMemObjType(type);
        member.setMemObjId(memberId);
        member.setUserRole(UserRole.MEMBER.name());
        member.setCreatorId(CurrentUserHolder.getCurrentUserId());
        member.setCreateTime(new Date());
        if (MemObjType.USER.name().equals(type)) {
            member.setLastReadMessageId(messageMapper.selectLatestMessageId(sessionId));
            member.setLastReadTime(new Date());
        }
        memberService.save(member);
        return member;
    }

    @Transactional
    public void remove(Long sessionId, String type, Long memberId) {
        authorizationService.requireAdmin(sessionId);
        ByaiSessionMember target = memberService.findSessionMember(sessionId, type, memberId);
        if (target == null || UserRole.OWNER.name().equals(target.getUserRole())) {
            throw new IllegalArgumentException("Group member cannot be removed");
        }
        memberService.deleteMember(target.getByaiSessionMemberId());
    }

    @Transactional
    public void changeRole(Long sessionId, String type, Long memberId, String role) {
        authorizationService.requireOwner(sessionId);
        if (!MemObjType.isValid(type) || memberId == null || (!UserRole.ADMIN.name().equals(role)
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
            .filter(java.util.Objects::nonNull)
            .max(Long::compareTo)
            .orElse(0L);
        boundary.setExtParamValue(String.valueOf(latest));
        sessionExtService.save(boundary);
        return direct;
    }
}
