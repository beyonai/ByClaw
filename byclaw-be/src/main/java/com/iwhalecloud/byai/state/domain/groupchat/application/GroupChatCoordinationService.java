package com.iwhalecloud.byai.state.domain.groupchat.application;

import java.util.LinkedHashMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.HashSet;

import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionExt;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatMessageRejectedException;
import com.iwhalecloud.byai.state.domain.session.service.SessionExtService;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import lombok.RequiredArgsConstructor;

/** Server-owned execution scope, persisted with existing session extensions. */
@Service
@RequiredArgsConstructor
public class GroupChatCoordinationService {
    @org.springframework.beans.factory.annotation.Autowired
    private org.springframework.beans.factory.ObjectProvider<com.iwhalecloud.byai.state.domain.session.service.SessionService> sessions;
    @org.springframework.beans.factory.annotation.Autowired
    private com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper tasks;
    @org.springframework.beans.factory.annotation.Autowired
    private org.springframework.beans.factory.ObjectProvider<GroupChatApplicationService> applications;
    public static final String SCOPE_EXT = "group_coordination_scope";
    public static final String SCHEMA_VERSION = "byclaw.group-coordination/v1";
    public static final String COORDINATED = "COORDINATED";
    private final SessionExtService extensions;
    private final SequenceService sequence;
    private final SessionMemberService members;

    public Map<String, Object> resolveForExecution(Long groupId, Long taskId, List<Long> selectedIds,
        Long coordinatorId, String mode) {
        Map<String, Object> scope = new LinkedHashMap<>();
        scope.put("schemaVersion", SCHEMA_VERSION);
        scope.put("mode", mode);
        scope.put("groupSessionId", groupId.toString());
        scope.put("taskSessionId", taskId.toString());
        scope.put("coordinatorAgentId", coordinatorId.toString());
        scope.put("allowedAgentIds", selectedIds.stream().filter(id -> !id.equals(coordinatorId))
            .distinct().map(Object::toString).toList());
        saveScope(taskId, scope);
        return scope;
    }

    public void saveScope(Long sessionId, Map<String, Object> scope) {
        ByaiSessionExt ext = extensions.findOneByExtParamCode(sessionId, SCOPE_EXT);
        if (ext == null) {
            ext = new ByaiSessionExt();
            ext.setExtId(sequence.nextVal());
            ext.setSessionId(sessionId);
            ext.setExtParamCode(SCOPE_EXT);
            ext.setExtParamName(SCOPE_EXT);
            ext.setExtParamValue(JSON.toJSONString(scope));
            extensions.save(ext);
        }
        else if (!JSON.parseObject(ext.getExtParamValue()).equals(scope)) {
            throw new GroupChatMessageRejectedException("An existing group task cannot change its coordination scope");
        }
    }

    public Map<String, Object> findScope(Long sessionId) {
        if (sessionId == null) return null;
        var sessionService = sessions == null ? null : sessions.getIfAvailable();
        HashSet<Long> visited = new HashSet<>();
        Long current = sessionId;
        while (current != null && visited.add(current)) {
            ByaiSessionExt ext = extensions.findOneByExtParamCode(current, SCOPE_EXT);
            if (ext != null) {
                Map<String, Object> scope = JSON.parseObject(ext.getExtParamValue());
                if (!SCHEMA_VERSION.equals(scope.get("schemaVersion"))
                    || !current.toString().equals(scope.get("taskSessionId"))) {
                    throw new GroupChatMessageRejectedException("Invalid group coordination scope");
                }
                return scope;
            }
            var session = sessionService == null ? null : sessionService.findById(current);
            current = session == null ? null : session.getParentSessionId();
        }
        return null;
    }

    public boolean isCoordinated(Long sessionId) {
        Map<String, Object> scope = findScope(sessionId);
        return scope != null && COORDINATED.equals(scope.get("mode"));
    }

    public void attach(ByaiGroupChatTask task) {
        if (task != null) task.setGroupCoordination(findScope(task.getTaskSessionId()));
    }

    /** Routing hints only; Harness must verify the durable child lineage and assigned employee before resuming. */
    public static void attachDshTarget(AssistantChatDto request, Map<?, ?> scope, Map<String, Object> gatewayParams) {
        Map<String, Object> params = request.getExtParams();
        if (params == null || params.get("dsh_target_session_id") == null) return;
        Object root = params.get("byclaw_root_session_id");
        if (root == null || !request.getSessionId().toString().equals(root.toString())
            || !scope.get("taskSessionId").toString().equals(root.toString())) {
            throw new GroupChatMessageRejectedException("Group child routing must use its original task session");
        }
        for (String key : List.of("byclaw_root_session_id", "dsh_target_session_id", "dsh_parent_session_id")) {
            Object value = params.get(key);
            if (value == null) continue;
            if (!(value instanceof String id) || id.length() > 200 || !id.matches("[A-Za-z0-9._:-]+")) {
                throw new GroupChatMessageRejectedException("Invalid group child session routing hint");
            }
            gatewayParams.put(key, value);
        }
    }

    /** Applied after resolving the actual agent; frontend scope values cannot authorize execution. */
    @org.springframework.transaction.annotation.Transactional
    public void validateRequest(AssistantChatDto request) {
        if (request == null) return;
        Map<String, Object> scope = findScope(request.getSessionId());
        if (scope == null && request.getSessionId() != null && tasks != null && applications != null) {
            var sessionService = sessions == null ? null : sessions.getIfAvailable();
            var session = sessionService == null ? null : sessionService.findById(request.getSessionId());
            ByaiGroupChatTask task = session == null || !"GROUP_TASK".equals(session.getState())
                ? null : tasks.selectById(request.getSessionId());
            if (task != null && "ACTIVE".equals(task.getStatus())
                && Objects.equals(task.getInitiatorUserId(),
                    com.iwhalecloud.byai.common.login.auth.CurrentUserHolder.getCurrentUserId())) {
                GroupChatApplicationService application = applications.getIfAvailable();
                if (application != null) {
                    Long coordinatorId = application.ensureDefaultCoordinator(task.getGroupSessionId());
                    // The group lock clears prior MyBatis reads. A concurrent first continuation may have
                    // already frozen this task while we waited; never overwrite its chosen roster.
                    scope = findScope(task.getTaskSessionId());
                    ByaiGroupChatTask current = tasks.selectById(task.getTaskSessionId());
                    if (scope == null && current != null && "ACTIVE".equals(current.getStatus())) {
                        List<Long> agents = members.findSessionMembers(task.getGroupSessionId(), "AGENT", null)
                            .stream().map(member -> member.getMemObjId()).toList();
                        scope = resolveForExecution(task.getGroupSessionId(), task.getTaskSessionId(), agents,
                            coordinatorId, "DIRECT");
                    }
                }
            }
        }
        Map<String, Object> params = request.getExtParams() == null ? new HashMap<>() : new HashMap<>(request.getExtParams());
        params.remove("groupCoordination");
        params.remove("groupCoordinator");
        params.remove("groupContextSnapshot");
        params.remove("groupTaskContext");
        params.remove("groupChat");
        params.remove("groupPublicContext");
        if (scope != null) params.put("groupCoordination", scope);
        request.setExtParams(params);
        if (scope == null) return;
        attachDshTarget(request, scope, new HashMap<>());
        Long groupId = Long.valueOf(scope.get("groupSessionId").toString());
        Long coordinator = Long.valueOf(scope.get("coordinatorAgentId").toString());
        if (members.findSessionMember(groupId, "AGENT", coordinator) == null) {
            throw new GroupChatMessageRejectedException("Group work assistant is no longer a group member");
        }
        boolean root = request.getSessionId().toString().equals(scope.get("taskSessionId"));
        List<?> allowed = (List<?>) scope.get("allowedAgentIds");
        if (!root) {
            var sessionService = sessions == null ? null : sessions.getIfAvailable();
            var session = sessionService == null ? null : sessionService.findById(request.getSessionId());
            if (session == null || !Objects.equals(session.getObjectId(), request.getAgentId())
                || (!allowed.contains(String.valueOf(request.getAgentId())) && !coordinator.equals(request.getAgentId()))
                || members.findSessionMember(groupId, "AGENT", request.getAgentId()) == null) {
                throw new GroupChatMessageRejectedException("Child session must continue with its assigned group employee");
            }
        }
        for (Object id : allowed) {
            if (members.findSessionMember(groupId, "AGENT", Long.valueOf(id.toString())) == null) {
                throw new GroupChatMessageRejectedException("A selected employee is no longer a group member");
            }
        }
        if (members.findSessionMember(groupId, "AGENT", request.getAgentId()) == null) {
            throw new GroupChatMessageRejectedException("The task employee is no longer a group member");
        }
        if (!COORDINATED.equals(scope.get("mode"))) return;
        if (root && !Objects.equals(coordinator, request.getAgentId())) {
            throw new GroupChatMessageRejectedException("Group coordination must continue through the group work assistant");
        }
        if (params != null && (params.containsKey("multiAgent") || params.containsKey("multi_agent"))) {
            throw new GroupChatMessageRejectedException("Group coordination cannot use parallel chat lanes");
        }
        if (request.getResourceList() != null) {
            request.getResourceList().stream()
                .filter(resource -> resource.getResourceType()
                    == com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum.DIG_EMPLOYEE)
                .forEach(resource -> {
                    String id = resource.getResourceId();
                    if ((!coordinator.toString().equals(id) && !allowed.contains(id))
                        || members.findSessionMember(groupId, "AGENT", Long.valueOf(id)) == null) {
                        throw new GroupChatMessageRejectedException("Agent is outside this group coordination task");
                    }
                });
        }
    }
}
