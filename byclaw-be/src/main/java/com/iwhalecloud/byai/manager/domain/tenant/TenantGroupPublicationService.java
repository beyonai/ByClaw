package com.iwhalecloud.byai.manager.domain.tenant;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.alibaba.fastjson.JSONObject;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatPendingPublication;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatPublicationUploader;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTaskService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatTaskCompleteRequest;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatTaskFile;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/** 文件上传复用 BE 用例，上传检查点和最终发布均由 Node 持久化。 */
@Service
public class TenantGroupPublicationService {
    @org.springframework.beans.factory.annotation.Autowired
    private com.iwhalecloud.byai.state.domain.groupchat.application.HumanTaskCompletionBridge humanTaskCompletion;
    @org.springframework.beans.factory.annotation.Autowired
    private com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatAgentMentionParser mentions;
    @org.springframework.beans.factory.annotation.Autowired
    private MultiDeviceBroadcastService broadcaster;
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
        if (humanTaskCompletion != null) {
            var submitted = humanTaskCompletion.complete(taskId, request);
            if (submitted != null) return mapper.valueToTree(submitted);
        }
        JsonNode task = data.read(tenant, "group-chat/tasks/" + taskId);
        Long pendingId = request == null ? null : request.getPendingPublicationId();
        if (pendingId != null && (request.getText() != null || request.getFiles() != null && !request.getFiles().isEmpty()))
            throw new IllegalArgumentException(I18nUtil.get("tenant.publication.noOverride"));
        boolean direct = "PRIVATE".equals(task.path("status").asText());
        if (direct && (pendingId == null || pendingId <= 0))
            throw new IllegalArgumentException(I18nUtil.get("tenant.publication.confirmationRequired"));
        String receipt = "group-chat/tasks/" + taskId + "/publication" + (direct ? "?pendingPublicationId=" + pendingId : "");
        JsonNode existing = data.read(tenant, receipt);
        if (existing != null && !existing.isNull()) {
            if (pendingId != null && pendingId != existing.path("pendingPublicationId").asLong()) throw new IllegalArgumentException(I18nUtil.get("tenant.publication.outdated"));
            return existing;
        }
        if (!direct && (!"ACTIVE".equals(task.path("status").asText()) || "RUNNING".equals(task.path("turnStatus").asText())))
            throw new IllegalArgumentException(I18nUtil.get("tenant.publication.notReady"));
        try {
            return publish(tenant, taskId, request, task, pendingId, direct);
        }
        catch (RuntimeException failure) {
            if (direct) {
                // 并发确认可能已消费这张卡片；只恢复该版本的已提交成果，不读取或消费后续草稿。
                JsonNode committed = data.read(tenant, receipt);
                if (committed != null && !committed.isNull()) return committed;
            }
            throw failure;
        }
    }

    private JsonNode publish(TenantRequestContext tenant, Long taskId, GroupChatTaskCompleteRequest request,
        JsonNode task, Long pendingId, boolean direct) {
        String groupId = task.path("groupSessionId").asText();
        JsonNode group = data.read(tenant, "group-chats/" + groupId);
        List<GroupChatTaskFile> files = request == null || request.getFiles() == null ? List.of() : request.getFiles();
        String text = request == null || request.getText() == null ? "" : request.getText().trim();
        if (pendingId != null) {
            JsonNode pending = data.read(tenant, "group-chat/tasks/" + taskId + "/pending-publication");
            if (pending == null || pending.path("pendingPublicationId").asLong() != pendingId) throw new IllegalArgumentException(I18nUtil.get("tenant.publication.outdated"));
            text = pending.path("text").asText("");
            if (!pending.path("sourcePaths").isEmpty()) files = upload(tenant, taskId, groupId, group, pending, direct);
        }
        Long authorizedCloud = files.isEmpty() ? null : cloudId(group);
        if (!files.isEmpty()) tasks.validateTenantFiles(authorizedCloud, files);
        List<Map<String, Object>> authorized = new ArrayList<>();
        for (GroupChatTaskFile file : files) {
            Map<String, Object> value = mapper.convertValue(file, new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() {});
            // 私聊确认后会消费草稿；将已校验的云盘归属保存在本次回执，供群成员以后读取成果。
            if (direct) value.put("cloudResourceId", authorizedCloud.toString());
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
        String preparedText = text;
        text = parsed.normalizedContent();
        Map<String, Object> payload = new HashMap<>();
        payload.put("metadata", Map.of("resourceList", parsed.resourceList(), "targetAgentId", task.path("targetAgentId").asText()));
        payload.put("taskSessionId", taskId.toString());
        payload.put("text", text);
        if (direct) payload.put("preparedText", preparedText);
        payload.put("files", authorized);
        if (pendingId != null) payload.put("pendingPublicationId", pendingId.toString());
        for (JsonNode member : group.path("members")) if ("AGENT".equals(member.path("memObjType").asText())
            && member.path("memObjId").asText().equals(task.path("targetAgentId").asText())) payload.put("creatorName", member.path("memName").asText());
        var committed = data.write(tenant, "POST", "/tasks/" + taskId + "/publication", groupId, "PUBLISH_TASK", payload);
        JsonNode result = committed.data();
        if (direct) {
            boolean firstConfirmation = result.path("newlyPublished").asBoolean();
            ObjectNode receipt = ((ObjectNode) result).deepCopy();
            receipt.remove("newlyPublished");
            result = receipt;
            if (!firstConfirmation) return receipt;
        }
        JSONObject event = new JSONObject();
        event.put("type", "GROUP_CHAT_EVENT");
        event.put("sessionId", groupId);
        event.put("messageId", result.path("messageId").asText());
        if (!direct) {
            event.put("taskId", taskId.toString());
            event.put("event", "TASK_PUBLISHED");
            event.put("status", "PUBLISHED");
            events.publishTenant(tenant, Long.valueOf(groupId), event);
        }
        JSONObject created = new JSONObject(event);
        created.put("event", "MESSAGE_CREATED");
        created.put("content", text);
        created.put("files", files);
        created.put("kind", "TASK_RESULT");
        created.put("creatorId", task.path("targetAgentId").asText());
        created.put("speaker", direct
            ? Map.of("type", "AGENT", "agentId", task.path("targetAgentId").asText(),
                "displayName", payload.getOrDefault("creatorName", ""))
            : Map.of("type", "AGENT", "agentId", task.path("targetAgentId").asText()));
        created.put("resourceList", parsed.resourceList());
        events.publishTenant(tenant, Long.valueOf(groupId), created);
        if (direct) {
            // 其他设备只清除用户刚确认的版本；群成员只收到上面的公开成果。
            JSONObject cleared = new JSONObject();
            cleared.put("type", "GROUP_CHAT_TASK_EVENT");
            cleared.put("event", "TASK_PUBLICATION_CLEARED");
            cleared.put("sessionId", taskId.toString());
            cleared.put("taskId", taskId.toString());
            cleared.put("pendingPublicationId", pendingId.toString());
            cleared.put("messageId", result.path("messageId").asText());
            broadcaster.broadcastTenantRawToUser(tenant, cleared, null);
        }
        return result;
    }

    private Long cloudId(JsonNode group) { return tasks.tenantProjectCloudResourceId(group.path("session").path("projectId").asLong()); }

    private List<GroupChatTaskFile> upload(TenantRequestContext tenant, Long taskId, String groupId, JsonNode group,
        JsonNode row, boolean direct) {
        ByaiGroupChatPendingPublication pending = new ByaiGroupChatPendingPublication();
        pending.setTaskSessionId(taskId);
        pending.setPendingPublicationId(row.path("pendingPublicationId").asLong());
        pending.setSourceFilesJson(row.path("sourcePaths").toString());
        pending.setUploadedFilesJson(row.path("uploadedFiles").toString());
        if (!row.path("cloudResourceId").isNull() && !row.path("cloudResourceId").isMissingNode()) pending.setCloudResourceId(row.path("cloudResourceId").asLong());
        return uploader.upload(pending, cloudId(group), direct, (cloud, uploaded) -> data.write(tenant, "PATCH",
            "/tasks/" + taskId + "/pending-publication", groupId, "CHECKPOINT_PUBLICATION",
            Map.of("taskSessionId", taskId.toString(), "pendingPublicationId", pending.getPendingPublicationId().toString(),
                "cloudResourceId", cloud.toString(), "uploadedFiles", uploadCheckpoint(uploaded, direct))));
    }

    private JSONObject uploadCheckpoint(String serialized, boolean direct) {
        JSONObject checkpoint = JSONObject.parseObject(serialized);
        if (direct) {
            // Node 使用 JavaScript 解析 JSON；大文件 ID 跨服务传递前必须保留十进制精度。
            for (String source : checkpoint.keySet()) {
                var files = checkpoint.getJSONArray(source);
                for (int i = 0; i < files.size(); i++) {
                    JSONObject file = files.getJSONObject(i);
                    if (file.get("fileId") != null) file.put("fileId", file.getString("fileId"));
                }
            }
        }
        return checkpoint;
    }
}
