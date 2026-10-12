package com.iwhalecloud.byai.manager.domain.tenant;

import com.alibaba.fastjson.JSONObject;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatPendingPublication;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatPublicationUploader;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTaskService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatTaskCompleteRequest;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatTaskFile;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/** 文件上传复用 BE 用例，上传检查点和最终发布均由 Node 持久化。 */
@Service
public class TenantGroupPublicationService {
    @org.springframework.beans.factory.annotation.Autowired
    private com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatAgentMentionParser mentions;
    private final TenantGroupData data;
    private final GroupChatTaskService tasks;
    private final GroupChatPublicationUploader uploader;
    private final GroupChatEventPublisher events;
    private final ObjectMapper mapper;

    public TenantGroupPublicationService(TenantGroupData data, GroupChatTaskService tasks,
        GroupChatPublicationUploader uploader, GroupChatEventPublisher events, ObjectMapper mapper) {
        this.data = data;
        this.tasks = tasks;
        this.uploader = uploader;
        this.events = events;
        this.mapper = mapper;
    }

    public JsonNode complete(TenantRequestContext tenant, Long taskId, GroupChatTaskCompleteRequest request) {
        JsonNode task = data.read(tenant, "group-chat/tasks/" + taskId);
        Long pendingId = request == null ? null : request.getPendingPublicationId();
        if (pendingId != null && (request.getText() != null || request.getFiles() != null && !request.getFiles().isEmpty()))
            throw new IllegalArgumentException("Confirm pending publication without overriding text/files");
        JsonNode existing = data.read(tenant, "group-chat/tasks/" + taskId + "/publication");
        if (existing != null && !existing.isNull()) {
            if (pendingId != null && pendingId != existing.path("pendingPublicationId").asLong()) throw new IllegalArgumentException("Pending publication is outdated");
            return existing;
        }
        if (!"ACTIVE".equals(task.path("status").asText()) || "RUNNING".equals(task.path("turnStatus").asText()))
            throw new IllegalArgumentException("Task is not ready for publication");
        String groupId = task.path("groupSessionId").asText();
        JsonNode group = data.read(tenant, "group-chats/" + groupId);
        List<GroupChatTaskFile> files = request == null || request.getFiles() == null ? List.of() : request.getFiles();
        String text = request == null || request.getText() == null ? "" : request.getText().trim();
        if (pendingId != null) {
            JsonNode pending = data.read(tenant, "group-chat/tasks/" + taskId + "/pending-publication");
            if (pending == null || pending.path("pendingPublicationId").asLong() != pendingId) throw new IllegalArgumentException("Pending publication is outdated");
            text = pending.path("text").asText("");
            if (!pending.path("sourcePaths").isEmpty()) files = upload(tenant, taskId, groupId, group, pending);
        }
        if (!files.isEmpty()) tasks.validateTenantFiles(cloudId(group), files);
        List<Map<String, Object>> authorized = new ArrayList<>();
        for (GroupChatTaskFile file : files) {
            Map<String, Object> value = mapper.convertValue(file, new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() {});
            value.put("resourceAuthorized", true); authorized.add(value);
        }
        // Mention parsing needs only authorized member identities, not Node ISO timestamps.
        List<com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember> memberIdentities = new ArrayList<>();
        for (JsonNode member : group.path("members")) {
            var identity = new com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember();
            identity.setMemObjType(member.path("memObjType").asText());
            if (!member.path("memObjId").isMissingNode() && !member.path("memObjId").isNull())
                identity.setMemObjId(member.path("memObjId").asLong());
            memberIdentities.add(identity);
        }
        var parsed = mentions.parseMembers(memberIdentities, task.path("targetAgentId").asLong(), text);
        text = parsed.normalizedContent();
        Map<String, Object> payload = new HashMap<>();
        payload.put("metadata", Map.of("resourceList", parsed.resourceList(), "targetAgentId", task.path("targetAgentId").asText()));
        payload.put("taskSessionId", taskId.toString());
        payload.put("text", text);
        payload.put("files", authorized);
        if (pendingId != null) payload.put("pendingPublicationId", pendingId.toString());
        for (JsonNode member : group.path("members")) if ("AGENT".equals(member.path("memObjType").asText())
            && member.path("memObjId").asText().equals(task.path("targetAgentId").asText())) payload.put("creatorName", member.path("memName").asText());
        var committed = data.write(tenant, "POST", "/tasks/" + taskId + "/publication", groupId, "PUBLISH_TASK", payload);
        JsonNode result = committed.data();
        JSONObject event = new JSONObject();
        event.put("type", "GROUP_CHAT_EVENT");
        event.put("event", "TASK_PUBLISHED");
        event.put("sessionId", groupId);
        event.put("taskId", taskId.toString());
        event.put("messageId", result.path("messageId").asText());
        event.put("status", "PUBLISHED");
        events.publishTenant(tenant, Long.valueOf(groupId), event);
        JSONObject created = new JSONObject(event);
        created.put("event", "MESSAGE_CREATED");
        created.put("content", text);
        created.put("files", files);
        created.put("kind", "TASK_RESULT");
        created.put("creatorId", task.path("targetAgentId").asText());
        created.put("resourceList", parsed.resourceList());
        events.publishTenant(tenant, Long.valueOf(groupId), created);
        return result;
    }

    private Long cloudId(JsonNode group) { return tasks.tenantProjectCloudResourceId(group.path("session").path("projectId").asLong()); }

    private List<GroupChatTaskFile> upload(TenantRequestContext tenant, Long taskId, String groupId, JsonNode group, JsonNode row) {
        ByaiGroupChatPendingPublication pending = new ByaiGroupChatPendingPublication();
        pending.setTaskSessionId(taskId);
        pending.setPendingPublicationId(row.path("pendingPublicationId").asLong());
        pending.setSourceFilesJson(row.path("sourcePaths").toString());
        pending.setUploadedFilesJson(row.path("uploadedFiles").toString());
        if (!row.path("cloudResourceId").isNull() && !row.path("cloudResourceId").isMissingNode()) pending.setCloudResourceId(row.path("cloudResourceId").asLong());
        return uploader.upload(pending, cloudId(group), (cloud, uploaded) -> data.write(tenant, "PATCH",
            "/tasks/" + taskId + "/pending-publication", groupId, "CHECKPOINT_PUBLICATION",
            Map.of("taskSessionId", taskId.toString(), "pendingPublicationId", pending.getPendingPublicationId().toString(),
                "cloudResourceId", cloud.toString(), "uploadedFiles", JSONObject.parseObject(uploaded))));
    }
}
