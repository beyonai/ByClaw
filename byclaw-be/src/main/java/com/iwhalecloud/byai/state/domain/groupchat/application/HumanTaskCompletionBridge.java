package com.iwhalecloud.byai.state.domain.groupchat.application;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectService;
import com.iwhalecloud.byai.manager.domain.tenant.*;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatPendingPublication;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatTaskAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.*;
import com.iwhalecloud.byai.state.domain.groupchat.humantask.HumanTaskService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/** 已绑定真人待办的成果提交；未绑定会话继续使用原群发布流程。 */
@Service
public class HumanTaskCompletionBridge {
    private final HumanTaskService human;
    private final GroupChatPendingPublicationStore pendingStore;
    private final GroupChatPublicationUploader uploader;
    private final GroupChatTaskAuthorizationService authorization;
    private final SessionService sessions;
    private final ProjectService projects;
    private final TenantGroupData tenantData;
    private final TenantModeService tenantModes;

    public HumanTaskCompletionBridge(HumanTaskService human, GroupChatPendingPublicationStore pendingStore,
        GroupChatPublicationUploader uploader, GroupChatTaskAuthorizationService authorization,
        SessionService sessions, ProjectService projects, TenantGroupData tenantData, TenantModeService tenantModes) {
        this.human = human; this.pendingStore = pendingStore; this.uploader = uploader;
        this.authorization = authorization; this.sessions = sessions; this.projects = projects;
        this.tenantData = tenantData; this.tenantModes = tenantModes;
    }

    public GroupChatTaskPublicationResponse complete(Long sessionId, GroupChatTaskCompleteRequest request) {
        JSONObject binding = human.binding(sessionId);
        if (binding == null || binding.isEmpty()) return null;
        Long pendingId = request == null ? null : request.getPendingPublicationId();
        if (pendingId == null || pendingId <= 0 || request.getText() != null
            || request.getFiles() != null && !request.getFiles().isEmpty()) {
            throw new IllegalArgumentException("HUMAN_TASK_DRAFT_CONFIRMATION_REQUIRED");
        }
        Long humanId = binding.getLong("humanTaskId");
        String requestId = "session:" + sessionId + ":" + pendingId;
        JSONObject existing = human.request(humanId, requestId);
        if (existing != null && existing.getJSONObject("result") != null) {
            return response(sessionId, pendingId, existing.getJSONObject("result"));
        }
        if ("ACCEPTED".equals(human.task(humanId).getString("status"))) {
            throw new IllegalArgumentException("HUMAN_TASK_ALREADY_ACCEPTED");
        }
        TenantRequestContext tenant = TenantRequestContextHolder.get();
        boolean remote = tenant != null && !tenantModes.isSharedDataTenant(tenant.enterpriseId());
        ByaiGroupChatPendingPublication pending;
        List<GroupChatTaskFile> files;
        if (remote) {
            var task = tenantData.read(tenant, "group-chat/tasks/" + sessionId);
            requireReady(task.path("status").asText(), task.path("turnStatus").asText());
            var row = tenantData.read(tenant, "group-chat/tasks/" + sessionId + "/pending-publication");
            if (row == null || row.path("pendingPublicationId").asLong() != pendingId) {
                throw new IllegalArgumentException("HUMAN_TASK_DRAFT_CHANGED");
            }
            pending = new ByaiGroupChatPendingPublication();
            pending.setTaskSessionId(sessionId); pending.setPendingPublicationId(pendingId);
            pending.setTextContent(row.path("text").asText(""));
            pending.setSourceFilesJson(row.path("sourcePaths").isArray() ? row.path("sourcePaths").toString() : "[]");
            pending.setUploadedFilesJson(row.path("uploadedFiles").isObject() ? row.path("uploadedFiles").toString() : "{}");
            if (row.hasNonNull("cloudResourceId")) pending.setCloudResourceId(row.path("cloudResourceId").asLong());
            var group = tenantData.read(tenant, "group-chats/" + binding.getString("groupSessionId"));
            Long cloud = JSON.parseArray(pending.getSourceFilesJson()).isEmpty() ? null
                : cloud(group.path("session").path("projectId").asLong());
            if (cloud == null && !JSON.parseArray(pending.getSourceFilesJson()).isEmpty()) {
                throw new IllegalArgumentException("HUMAN_TASK_CLOUD_UNAVAILABLE");
            }
            pending.setCloudResourceId(cloud);
            files = cloud == null ? List.of() : uploader.upload(pending, cloud, true, (id, uploaded) -> tenantData.write(tenant, "PATCH",
                "/tasks/" + sessionId + "/pending-publication", binding.getString("groupSessionId"),
                "CHECKPOINT_PUBLICATION", Map.of("taskSessionId", sessionId.toString(),
                    "pendingPublicationId", pendingId.toString(), "cloudResourceId", id.toString(),
                    "uploadedFiles", stringFileIds(uploaded))));
        } else {
            var task = authorization.requireInitiator(sessionId);
            requireReady(task.getStatus(), task.getTurnStatus());
            pending = pendingStore.find(sessionId);
            if (pending == null || !pendingId.equals(pending.getPendingPublicationId())) {
                throw new IllegalArgumentException("HUMAN_TASK_DRAFT_CHANGED");
            }
            if (JSON.parseArray(pending.getSourceFilesJson()).isEmpty()) {
                files = List.of();
            } else {
                var group = sessions.findById(task.getGroupSessionId());
                Long cloud = cloud(group.getProjectId());
                // 使用独占路径及既有 checkpoint，上传重试不会覆盖已提交附件。
                pending.setCloudResourceId(cloud);
                files = uploader.upload(pending, cloud, true);
            }
        }
        JSONObject payload = new JSONObject();
        payload.put("requestId", requestId); payload.put("taskSessionId", sessionId.toString());
        payload.put("pendingPublicationId", pendingId.toString()); payload.put("sourceType", "SESSION");
        payload.put("text", pending.getTextContent());
        // 同一草稿的幂等摘要只取原始输入，不受并发上传产生的独占文件路径影响。
        JSONObject fingerprint = new JSONObject();
        fingerprint.put("taskSessionId", sessionId.toString());
        fingerprint.put("pendingPublicationId", pendingId.toString());
        fingerprint.put("text", pending.getTextContent());
        fingerprint.put("sourcePaths", JSON.parseArray(pending.getSourceFilesJson()));
        payload.put("payloadHash", com.iwhalecloud.byai.state.domain.groupchat.humantask.HumanTaskRules.hash(fingerprint));
        com.alibaba.fastjson.JSONArray references = new com.alibaba.fastjson.JSONArray();
        for (GroupChatTaskFile file : files) {
            JSONObject ref = new JSONObject();
            ref.put("fileId", file.getFileId() == null ? null : file.getFileId().toString());
            ref.put("fileName", file.getFileName()); ref.put("filePath", file.getFilePath());
            ref.put("cloudResourceId", pending.getCloudResourceId() == null ? file.getCloudResourceId() : pending.getCloudResourceId().toString());
            references.add(ref);
        }
        payload.put("files", references);
        JSONObject submitted = human.submit(humanId, payload);
        return response(sessionId, pendingId, submitted);
    }

    private Long cloud(Long projectId) {
        var project = projects.findById(projectId);
        if (project == null || project.getCloudResourceId() == null) {
            throw new IllegalArgumentException("HUMAN_TASK_CLOUD_UNAVAILABLE");
        }
        return project.getCloudResourceId();
    }

    private void requireReady(String status, String turnStatus) {
        if (!("PRIVATE".equals(status) || "ACTIVE".equals(status)) || "RUNNING".equals(turnStatus)) {
            throw new IllegalArgumentException("HUMAN_TASK_EXECUTION_NOT_READY");
        }
    }

    private JSONObject stringFileIds(String json) {
        JSONObject checkpoint = JSON.parseObject(json);
        for (String source : checkpoint.keySet()) {
            for (Object item : checkpoint.getJSONArray(source)) {
                JSONObject file = (JSONObject) item;
                if (file.get("fileId") != null) file.put("fileId", file.getString("fileId"));
            }
        }
        return checkpoint;
    }

    private GroupChatTaskPublicationResponse response(Long session, Long pending, JSONObject result) {
        GroupChatTaskPublicationResponse response = new GroupChatTaskPublicationResponse();
        response.setTaskId(session); response.setPendingPublicationId(pending);
        response.setHumanTaskId(result.getLong("humanTaskId"));
        response.setSubmissionId(result.getLong("submissionId"));
        response.setVersion(result.getInteger("version")); response.setStatus(result.getString("status"));
        response.setText(result.getString("text"));
        response.setFiles(result.getJSONArray("files") == null ? List.of() : result.getJSONArray("files").toJavaList(GroupChatTaskFile.class));
        return response;
    }
}
