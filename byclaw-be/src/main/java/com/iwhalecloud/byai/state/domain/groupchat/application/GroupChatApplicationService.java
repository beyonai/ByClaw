package com.iwhalecloud.byai.state.domain.groupchat.application;

import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.alibaba.fastjson.JSON;

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
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectService;
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
    private final ProjectService projectService;
    private final ProjectMemberService projectMemberService;
    private final ByaiMessageMapper messageMapper;
    private final GroupChatExecutionCoordinator executionCoordinator;
    private final GroupChatEventPublisher eventPublisher;
    private final SessionExtService sessionExtService;
    private final GroupChatMentionService mentionService;

    @org.springframework.beans.factory.annotation.Autowired
    public GroupChatApplicationService(SessionService sessionService, SequenceService sequenceService,
        GroupChatAuthorizationService authorizationService, SessionMemberService memberService,
        ProjectService projectService, ProjectMemberService projectMemberService, ByaiMessageMapper messageMapper,
        GroupChatExecutionCoordinator executionCoordinator, GroupChatEventPublisher eventPublisher,
        SessionExtService sessionExtService, GroupChatMentionService mentionService) {
        this.sessionService = sessionService;
        this.sequenceService = sequenceService;
        this.authorizationService = authorizationService;
        this.memberService = memberService;
        this.projectService = projectService;
        this.projectMemberService = projectMemberService;
        this.messageMapper = messageMapper;
        this.executionCoordinator = executionCoordinator;
        this.eventPublisher = eventPublisher;
        this.sessionExtService = sessionExtService;
        this.mentionService = mentionService;
    }

    public GroupChatApplicationService(SessionService sessionService, SequenceService sequenceService,
        GroupChatAuthorizationService authorizationService, SessionMemberService memberService,
        ProjectService projectService, ProjectMemberService projectMemberService, ByaiMessageMapper messageMapper,
        GroupChatExecutionCoordinator executionCoordinator, GroupChatEventPublisher eventPublisher,
        SessionExtService sessionExtService) {
        this(sessionService, sequenceService, authorizationService, memberService, projectService,
            projectMemberService, messageMapper, executionCoordinator, eventPublisher, sessionExtService, null);
    }

    @Transactional
    public GroupChatDetailResponse create(GroupChatCreateRequest request) {
        if (projectService.findById(request.getProjectId()) == null) {
            throw new IllegalArgumentException("Project not found");
        }
        Long operatorId = CurrentUserHolder.getCurrentUserId();
        if (operatorId == null || !operatorId.equals(projectService.findById(request.getProjectId()).getCreateBy())) {
            throw new IllegalArgumentException("Only project administrator can create this group");
        }
        validateProjectUsers(request);
        ByaiSession session = new ByaiSession();
        session.setSessionId(sequenceService.nextVal());
        session.setProjectId(request.getProjectId());
        session.setSessionName(request.getName());
        session.setSessionType(SessionType.HS_AS.getCode());
        session.setCreatorId(request.getOwnerUserId());
        session.setEnterpriseId(CurrentUserHolder.getEnterpriseId());
        session.setCreateTime(new Date());
        session.setUpdateTime(new Date());
        sessionService.save(session);

        ArrayList<ByaiSessionMember> members = new ArrayList<>();
        addMember(members, session.getSessionId(), MemObjType.USER.name(), request.getOwnerUserId(), UserRole.OWNER.name());
        if (request.getAdminUserIds() != null) {
            request.getAdminUserIds().forEach(id -> addMember(members, session.getSessionId(), MemObjType.USER.name(), id,
                UserRole.ADMIN.name()));
        }
        if (request.getUserIds() != null) {
            request.getUserIds().forEach(id -> addMember(members, session.getSessionId(), MemObjType.USER.name(), id,
                UserRole.MEMBER.name()));
        }
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

    private void validateProjectUsers(GroupChatCreateRequest request) {
        java.util.Set<Long> userIds = new java.util.HashSet<>();
        userIds.add(request.getOwnerUserId());
        if (request.getAdminUserIds() != null) {
            userIds.addAll(request.getAdminUserIds());
        }
        if (request.getUserIds() != null) {
            userIds.addAll(request.getUserIds());
        }
        for (Long userId : userIds) {
            if (userId == null || !projectMemberService.isMember(request.getProjectId(), userId)) {
                throw new IllegalArgumentException("User is not a project member");
            }
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
        if (MemObjType.USER.name().equals(type) && !projectMemberService.isMember(session.getProjectId(), memberId)) {
            throw new IllegalArgumentException("User is not a project member");
        }
        if (memberService.findSessionMember(sessionId, type, memberId) != null) {
            throw new IllegalArgumentException("Member already exists");
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
