package com.iwhalecloud.byai.manager.domain.tenant;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.devloop.ProjectApplicationService;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectDTO;
import com.iwhalecloud.byai.state.domain.groupchat.application.WorkgroupTemplateService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupWorkAssistantService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatCreateRequest;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/** BE 初始化平台项目并解析模板，Node 原子创建租户群及初始成员。 */
@Service
public class TenantGroupCreationService {
    @org.springframework.beans.factory.annotation.Autowired
    private com.iwhalecloud.byai.manager.domain.devloop.service.ProjectMemberService projectMembers;
    private final TenantNodeClient node;
    private final TenantGroupData data;
    private final TenantGroupMemberService members;
    private final ProjectApplicationService projects;
    private final WorkgroupTemplateService templates;
    private final AuthApplicationService grants;
    @org.springframework.beans.factory.annotation.Autowired
    private GroupWorkAssistantService groupWorkAssistant;

    public TenantGroupCreationService(TenantNodeClient node, TenantGroupData data, TenantGroupMemberService members,
        ProjectApplicationService projects, WorkgroupTemplateService templates, AuthApplicationService grants) {
        this.node = node;
        this.data = data;
        this.members = members;
        this.projects = projects;
        this.templates = templates;
        this.grants = grants;
    }

    public JsonNode create(TenantRequestContext tenant, GroupChatCreateRequest request) {
        var userIds = new LinkedHashSet<>(request.getUserIds() == null ? List.<Long>of() : request.getUserIds());
        userIds.remove(tenant.userId());
        var agentIds = new LinkedHashSet<>(request.getAgentIds() == null ? List.<Long>of() : request.getAgentIds());
        if (request.getTemplateId() != null) agentIds.addAll(templates.resolveResourceIds(request.getTemplateId(), request.getExpectedTemplateVersion()));
        Long coordinatorAgentId = groupWorkAssistant.resolveDefaultCoordinatorId();
        agentIds.add(coordinatorAgentId);
        grants.grantDigitalEmployeesToUser(List.of(coordinatorAgentId), tenant.userId());
        var users = members.prepareMembers(tenant, "USER", new ArrayList<>(userIds));
        var agents = new ArrayList<>(members.prepareMembers(tenant, "AGENT", agentIds.stream()
            .filter(id -> !id.equals(coordinatorAgentId)).toList()));
        agents.add(members.prepareCoordinatorMember(coordinatorAgentId));
        List<Map<String, Object>> initial = new ArrayList<>();
        String name = CurrentUserHolder.getCurrentUserName();
        initial.add(Map.of("memObjType", "USER", "memObjId", Long.toString(tenant.userId()), "userRole", "OWNER", "memName", name == null ? "" : name));
        for (var member : java.util.stream.Stream.concat(users.stream(), agents.stream()).toList())
            initial.add(Map.of("memObjType", member.memObjType(), "memObjId", member.memObjId(), "userRole", "MEMBER",
                "memName", member.memName() == null ? "" : member.memName(), "resourceAuthorized", member.resourceAuthorized()));
        ProjectDTO projectRequest = new ProjectDTO();
        projectRequest.setProjectName(request.getName());
        projectRequest.setDescription(request.getGoal());
        var project = projects.createGroupChatProject(projectRequest);
        if (!userIds.isEmpty()) projectMembers.addMembers(project.getProjectId(), new ArrayList<>(userIds),
            com.iwhalecloud.byai.common.constants.devloop.MemberRole.MEMBER);
        String id = Long.toString(cn.hutool.core.util.IdUtil.getSnowflakeNextId());
        List<String> asserted = new ArrayList<>(); asserted.add(Long.toString(tenant.userId()));
        users.forEach(user -> asserted.add(user.memObjId()));
        node.command(tenant, "POST", "/internal/v1/group-chats", id, "CREATE_GROUP", new TenantNodeModels.Fields(Map.of(
            "sessionName", request.getName(), "sessionContent", request.getGoal() == null ? "" : request.getGoal(),
            "projectId", project.getProjectId().toString(), "members", initial,
            "coordinatorAgentId", coordinatorAgentId.toString())), java.util.UUID.randomUUID().toString(), asserted);
        if (!agentIds.isEmpty()) {
            userIds.add(tenant.userId());
            for (Long user : userIds) grants.grantDigitalEmployeesToUser(new ArrayList<>(agentIds), user);
        }
        return data.read(tenant, "group-chats/" + id);
    }
}
