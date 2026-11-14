package com.iwhalecloud.byai.state.domain.groupchat.application;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectService;
import com.iwhalecloud.byai.manager.domain.tenant.*;
import com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService;
import com.iwhalecloud.byai.state.domain.groupchat.humantask.HumanTaskService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

/** 直接回复使用独立上传入口；上传检查点与最终待办版本分开持久化。 */
@Service
public class HumanTaskDirectSubmissionService {
    private final HumanTaskService human;
    private final DatasetApplicationService datasets;
    private final SessionService sessions;
    private final ProjectService projects;
    private final TenantGroupData tenantData;
    private final TenantModeService tenantModes;

    public HumanTaskDirectSubmissionService(HumanTaskService human, DatasetApplicationService datasets,
        SessionService sessions, ProjectService projects, TenantGroupData tenantData, TenantModeService tenantModes) {
        this.human = human; this.datasets = datasets; this.sessions = sessions; this.projects = projects;
        this.tenantData = tenantData; this.tenantModes = tenantModes;
    }

    public JSONObject submit(Long humanId, String requestId, String text, MultipartFile[] files) throws Exception {
        if (requestId == null || !requestId.matches("[A-Za-z0-9_-]{1,121}")) {
            throw new IllegalArgumentException("HUMAN_TASK_INVALID_REQUEST_ID");
        }
        String content = text == null ? "" : text.trim();
        MultipartFile[] attachments = files == null ? new MultipartFile[0] : files;
        if (content.isBlank() && attachments.length == 0) throw new IllegalArgumentException("HUMAN_TASK_EMPTY_SUBMISSION");
        String hash = digest(content, attachments);
        String key = "direct:" + requestId;
        JSONObject checkpoint = human.request(humanId, key);
        if (checkpoint != null && !hash.equals(checkpoint.getString("payloadHash"))) {
            throw new IllegalArgumentException("HUMAN_TASK_IDEMPOTENCY_CONFLICT");
        }
        if (checkpoint != null && checkpoint.getJSONObject("result") != null) return checkpoint.getJSONObject("result");
        JSONObject task = human.task(humanId);
        if ("ACCEPTED".equals(task.getString("status"))) throw new IllegalArgumentException("HUMAN_TASK_ALREADY_ACCEPTED");
        JSONObject progress = checkpoint == null || checkpoint.getJSONObject("payload") == null
            ? new JSONObject() : checkpoint.getJSONObject("payload");
        human.checkpoint(humanId, key, hash, progress);
        JSONArray uploaded = progress.getJSONArray("files");
        if (uploaded == null) uploaded = new JSONArray();
        Long cloud = attachments.length == 0 ? null : cloud(task.getLong("groupSessionId"));
        for (int index = uploaded.size(); index < attachments.length; index++) {
            MultipartFile file = attachments[index];
            // 独占本次尝试的路径，checkpoint 前进程退出也不会覆盖已有附件。
            String directory = "/group-human-task-results/" + humanId + "/" + requestId + "/" + index + "/" + UUID.randomUUID();
            var result = datasets.uploadFiles(new MultipartFile[]{file}, cloud, directory,
                file.getOriginalFilename(), false, false, false, false, null, Map.of());
            if (result == null || result.getUploadItems() == null || result.getUploadItems().size() != 1
                || result.getFailedItems() != null && !result.getFailedItems().isEmpty()) {
                throw new IllegalStateException("HUMAN_TASK_UPLOAD_FAILED");
            }
            var item = result.getUploadItems().get(0);
            if (Boolean.FALSE.equals(item.getSuccess()) || item.getFilePath() == null
                || !item.getFilePath().startsWith(directory + "/")) throw new IllegalStateException("HUMAN_TASK_UPLOAD_FAILED");
            JSONObject ref = new JSONObject();
            ref.put("fileId", item.getFileId() == null ? null : item.getFileId().toString());
            ref.put("fileName", item.getFileName()); ref.put("filePath", item.getFilePath());
            ref.put("cloudResourceId", cloud.toString()); uploaded.add(ref);
            progress.put("files", uploaded);
            human.checkpoint(humanId, key, hash, progress);
        }
        JSONObject payload = new JSONObject();
        payload.put("requestId", key); payload.put("payloadHash", hash); payload.put("sourceType", "DIRECT");
        payload.put("text", content); payload.put("files", uploaded);
        return human.submit(humanId, payload);
    }

    private Long cloud(Long groupId) {
        TenantRequestContext tenant = TenantRequestContextHolder.get();
        Long projectId = tenant != null && !tenantModes.isSharedDataTenant(tenant.enterpriseId())
            ? tenantData.read(tenant, "group-chats/" + groupId).path("session").path("projectId").asLong()
            : sessions.findById(groupId).getProjectId();
        var project = projects.findById(projectId);
        if (project == null || project.getCloudResourceId() == null) throw new IllegalArgumentException("HUMAN_TASK_CLOUD_UNAVAILABLE");
        return project.getCloudResourceId();
    }

    private String digest(String text, MultipartFile[] files) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        digest.update(JSON.toJSONString(text).getBytes(StandardCharsets.UTF_8));
        for (MultipartFile file : files) {
            String name = file.getOriginalFilename();
            if (name == null || name.isBlank() || name.contains("/") || name.contains("\\") || name.equals(".") || name.equals("..")) {
                throw new IllegalArgumentException("HUMAN_TASK_INVALID_FILENAME");
            }
            digest.update(JSON.toJSONString(java.util.List.of(name, file.getSize())).getBytes(StandardCharsets.UTF_8));
            try (InputStream input = file.getInputStream()) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) != -1) digest.update(buffer, 0, count);
            }
        }
        return HexFormat.of().formatHex(digest.digest());
    }
}
