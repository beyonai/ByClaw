package com.iwhalecloud.byai.manager.domain.tenant;

import com.alibaba.fastjson.JSONObject;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatPublicationUploader;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatPendingPublicationRequest;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import java.util.HashMap;
import java.util.Map;
import org.springframework.stereotype.Service;

/** 任务写入只经过 Node，平台停止执行和文件操作仍在 BE。 */
@Service
public class TenantGroupTaskService {
    @org.springframework.beans.factory.annotation.Autowired
    private com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService broadcaster;
    private final TenantGroupData data;
    private final ObjectMapper mapper;
    private final TenantGroupTaskStopService tasks;
    private final GroupChatEventPublisher events;

    public TenantGroupTaskService(TenantGroupData data, ObjectMapper mapper, TenantGroupTaskStopService tasks,
        GroupChatEventPublisher events) {
        this.data = data;
        this.mapper = mapper;
        this.tasks = tasks;
        this.events = events;
    }

    public JsonNode prepare(TenantRequestContext tenant, Long taskId, GroupChatPendingPublicationRequest request) {
        JsonNode task = data.read(tenant, "group-chat/tasks/" + taskId);
        String groupId = task.path("groupSessionId").asText();
        Map<String, Object> payload = new HashMap<>();
        payload.put("taskSessionId", taskId.toString());
        payload.put("pendingPublicationId", Long.toString(cn.hutool.core.util.IdUtil.getSnowflakeNextId()));
        payload.put("text", request.getText() == null ? "" : request.getText().trim());
        payload.put("sourcePaths", request.getSourcePaths() == null ? java.util.List.of()
            : request.getSourcePaths().stream().map(GroupChatPublicationUploader::validateSourcePath).distinct().toList());
        if (request.getExpectedPendingPublicationId() != null)
            payload.put("expectedPendingPublicationId", request.getExpectedPendingPublicationId().toString());
        data.write(tenant, "POST", "/tasks/" + taskId + "/pending-publication", groupId, "SAVE_PENDING_PUBLICATION", payload);
        JsonNode pending = data.read(tenant, "group-chat/tasks/" + taskId + "/pending-publication");
        if (pending != null && !pending.isNull()) {
            JSONObject event = new JSONObject();
            event.put("type", "GROUP_CHAT_TASK_EVENT");
            event.put("event", "TASK_PUBLICATION_PREPARED");
            event.put("sessionId", taskId.toString());
            event.put("taskId", taskId.toString());
            event.put("pendingPublicationId", pending.path("pendingPublicationId").asText());
            broadcaster.broadcastTenantRawToUser(tenant, event, null);
        }
        return pending;
    }

    public void cancel(TenantRequestContext tenant, Long taskId) {
        // 只读取取消所需的公开任务字段；Node 再检查发起人或管理员权限。
        JsonNode task = data.read(tenant, "group-chat/tasks/" + taskId + "/cancellation");
        String groupId = task.path("groupSessionId").asText();
        JsonNode cancelled = data.write(tenant, "POST", "/tasks/" + taskId + "/cancel", groupId,
            "CANCEL_TASK", Map.of("taskSessionId", taskId.toString())).data();
        tasks.stop(tenant, cancelled);
        JSONObject event = new JSONObject();
        event.put("type", "GROUP_CHAT_EVENT");
        event.put("event", "TASK_STATUS_CHANGED");
        event.put("sessionId", groupId);
        event.put("taskId", taskId.toString());
        event.put("status", "CANCELLED");
        events.publishTenant(tenant, Long.valueOf(groupId), event);
    }
}
