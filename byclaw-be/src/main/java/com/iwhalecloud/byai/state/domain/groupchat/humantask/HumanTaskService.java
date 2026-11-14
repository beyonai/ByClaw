package com.iwhalecloud.byai.state.domain.groupchat.humantask;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.fasterxml.jackson.core.type.TypeReference;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.tenant.*;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import static com.iwhalecloud.byai.state.domain.groupchat.humantask.HumanTaskRules.*;
/** One contract routes to the database that owns the group; independent tenants never fall back to shared storage. */
@Service
public class HumanTaskService {

    private final HumanTaskLocalService local;

    private final TenantModeService modes;

    private final TenantNodeClient node;

    private final GroupChatEventPublisher events;

    private final SsResourceService resources;

    public HumanTaskService(HumanTaskLocalService local, TenantModeService modes, TenantNodeClient node,
    GroupChatEventPublisher events, SsResourceService resources) {
        this.local = local;
        this.modes = modes;
        this.node = node;
        this.events = events;
        this.resources = resources;
    }

    public JSONObject task(Long id) {
        return call("task", object("humanTaskId", id));
    }

    public JSONObject binding(Long id) {
        return call("binding", object("taskSessionId", id));
    }

    public JSONObject bind(Long id, Long session, String type) {
        JSONObject b = object("humanTaskId", id);
        b.put("taskSessionId", session.toString());
        b.put("entryType", type);
        return call("bind", b);
    }

    public JSONObject submit(Long id, JSONObject payload) {
        JSONObject b = copy(payload);
        b.put("humanTaskId", id.toString());
        return call("submit", b);
    }

    public JSONObject request(Long id, String key) {
        JSONObject b = object("humanTaskId", id);
        b.put("requestId", key);
        return call("request", b);
    }

    public JSONObject checkpoint(Long id, String key, String digest, JSONObject payload) {
        JSONObject b = object("humanTaskId", id);
        b.put("requestId", key);
        b.put("payloadHash", digest);
        b.put("payload", payload);
        return call("checkpoint", b);
    }

    public JSONObject call(String action, JSONObject input) {
        Long actor = CurrentUserHolder.getCurrentUserId();
        TenantRequestContext tenant = TenantRequestContextHolder.get();
        if (tenant != null)actor = tenant.userId();
        require(actor != null && actor>0, "AUTHENTICATION_REQUIRED");
        Long enterprise = null;
        if (tenant != null) {
            enterprise = tenant.enterpriseId();
        } else if (CurrentUserHolder.getLoginInfo() != null) {
            enterprise = CurrentUserHolder.getLoginInfo().getEnterpriseId();
        }
        // Personal workgroups use a separate logical scope, not the cloud project fallback enterprise.
        if (enterprise == null || enterprise <= 0)enterprise = 0L;
        boolean remote = tenant != null && !modes.isSharedDataTenant(enterprise);
        JSONObject body = copy(input);
        // This field is an internal assertion from the authenticated Java-to-Node boundary, never public input.
        body.remove("_resolvedSender");
        body.remove("_resolvedCoordinator");
        JSONObject result;
        if (remote) {
            if ("bind".equals(action) && !body.containsKey("taskSessionId") && body.get("agentIds") != null) {
                require(body.get("agentIds") instanceof com.alibaba.fastjson.JSONArray, "INVALID_AGENT_IDS");
                require(body.get("agentId") == null, "INVALID_AGENT_IDS");
            }
            if ("bind".equals(action) && !body.containsKey("taskSessionId") && body.getJSONArray("agentIds") != null
                && body.getJSONArray("agentIds").stream().map(value -> String.valueOf(value).trim()).distinct().count() > 1) {
                resolveRemoteCoordinator(tenant, body);
            }
            if ("createProposal".equals(action) && body.get("sourceTaskSessionId") != null) {
                resolveRemoteSenderName(tenant, body);
            }
            Map<String, Object> response = node.request(tenant, "POST", "/internal/v1/group-human-tasks/"+action, body, new TypeReference<Map<String, Object>>() {
            });
            result = response == null?null:JSON.parseObject(JSON.toJSONString(response));
        }
        else {
            boolean outerTransaction=TransactionSynchronizationManager.isActualTransactionActive();
            try {
                result=local.call(enterprise, actor, action, body);
            } catch (RuntimeException failure) {
                // A racing insert/CAS rolls back its own transaction before replay reads the winner's result.
                boolean replayable=java.util.Set.of("createProposal", "createDirect").contains(action) && failure instanceof org.springframework.dao.DuplicateKeyException
                    || "confirm".equals(action) && failure instanceof org.springframework.web.server.ResponseStatusException status
                        && "HUMAN_TASK_STALE_PROPOSAL".equals(status.getReason());
                if(outerTransaction || !replayable)throw failure;
                result=local.call(enterprise, actor, action, body);
            }
        }
        // Only the transaction that inserted a message returns this transient marker; retries do not broadcast again.
        if (result != null) {
            String createdMessageId = result.getString("_createdMessageId");
            result.remove("_createdMessageId");
            if (createdMessageId != null && java.util.Set.of("createProposal", "createDirect", "confirm").contains(action))
                notifyCreated(tenant, remote, result, action, createdMessageId);
        }
        if (result != null && java.util.Set.of("createProposal", "createDirect", "confirm", "updateProposal", "submit", "review").contains(action)) {
            JSONObject scope = java.util.Set.of("submit", "review").contains(action)?task(id(body, "humanTaskId")):result;
            notifyChange(tenant, remote, scope, action);
        }
        return result;
    }

    /** Resolve the published coordinator from server-owned group state, never from request identity fields. */
    private void resolveRemoteCoordinator(TenantRequestContext tenant, JSONObject body) {
        Map<String, Object> task = node.request(tenant, "POST", "/internal/v1/group-human-tasks/task",
            object("humanTaskId", id(body, "humanTaskId")), new TypeReference<Map<String, Object>>() { });
        require(task != null, "NOT_FOUND");
        Map<String, Object> group = node.request(tenant, "GET", "/internal/v1/group-chats/" + task.get("groupSessionId"),
            null, new TypeReference<Map<String, Object>>() { });
        require(group != null && group.get("coordinatorAgentId") != null, "COORDINATOR_UNAVAILABLE");
        Long coordinator = Long.valueOf(group.get("coordinatorAgentId").toString());
        var resource = resources.findById(coordinator);
        require(resource != null && Integer.valueOf(2).equals(resource.getResourceStatus())
            && "DIG_EMPLOYEE".equals(resource.getResourceBizType()), "COORDINATOR_UNAVAILABLE");
        body.put("_resolvedCoordinator", Map.of("coordinatorAgentId", coordinator.toString(),
            "coordinatorName", resource.getResourceName() == null ? "" : resource.getResourceName(),
            "coordinatorAuthorized", true));
    }

    private void resolveRemoteSenderName(TenantRequestContext tenant, JSONObject body) {
        JSONObject source = new JSONObject();
        for (String field : java.util.List.of("sourceTaskSessionId", "groupSessionId", "sourceMessageId")) {
            if (body.get(field) != null) source.put(field, body.get(field));
        }
        Map<String, Object> verified = node.request(tenant, "POST", "/internal/v1/group-human-tasks/proposalSender",
            source, new TypeReference<Map<String, Object>>() { });
        require(verified != null && "AGENT".equals(verified.get("senderType")), "SOURCE_MISMATCH");
        Long sender = id(new JSONObject(verified), "senderId");
        // The tenant owns execution identity; only the platform resource store owns the current employee name.
        var resource = resources.findById(sender);
        if (resource != null && resource.getResourceName() != null && !resource.getResourceName().isBlank()) {
            JSONObject resolved = object("senderId", sender);
            resolved.put("senderName", resource.getResourceName());
            body.put("_resolvedSender", resolved);
        }
    }

    private void notifyCreated(TenantRequestContext tenant, boolean remote, JSONObject batch, String action, String messageId) {
        boolean agent = "AGENT".equals(batch.getString("senderType"));
        String kind = "createProposal".equals(action) ? "HUMAN_TASK_PROPOSAL" : "HUMAN_TASK_BATCH";
        JSONObject event = new JSONObject();
        event.put("type", "GROUP_CHAT_EVENT");
        event.put("event", "MESSAGE_CREATED");
        event.put("sessionId", batch.getString("groupSessionId"));
        event.put("messageId", messageId);
        event.put("topicId", messageId);
        event.put("batchId", batch.getString("batchId"));
        event.put("kind", kind);
        event.put("metadata", Map.of("scene", "GROUP_CHAT", "kind", kind, "batchId", batch.getString("batchId")));
        event.put("creatorId", batch.getString("senderId"));
        event.put("creatorName", batch.getString("senderName"));
        event.put("initiatorUserId", batch.getString("initiatorUserId"));
        event.put("usage", agent ? 2 : 1);
        event.put("role", agent ? "assistant" : "user");
        event.put("content", "HUMAN_TASK_PROPOSAL".equals(kind) ? "待办任务提案" : "待办任务");
        event.put("complete", true);
        event.put("createdAt", java.time.Instant.parse(batch.getString("HUMAN_TASK_PROPOSAL".equals(kind) ? "createdAt" : "confirmedAt")).toEpochMilli());
        JSONObject speaker = new JSONObject();
        speaker.put("type", agent ? "AGENT" : "USER");
        speaker.put(agent ? "agentId" : "userId", batch.getString("senderId"));
        speaker.put("displayName", batch.getString("senderName"));
        if (agent) speaker.put("agentName", batch.getString("senderName"));
        event.put("speaker", speaker);
        event.put("attachments", java.util.List.of());
        event.put("resourceList", java.util.List.of());
        Runnable send = () -> {
            try {
                if (remote) events.publishTenant(tenant, batch.getLong("groupSessionId"), event);
                else events.publish(batch.getLong("groupSessionId"), event, null);
            } catch (RuntimeException ignored) { /* History recovers committed cards after a delivery failure. */ }
        };
        if (TransactionSynchronizationManager.isSynchronizationActive()) TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override public void afterCommit() { send.run(); }
        });
        else send.run();
    }

    private void notifyChange(TenantRequestContext tenant, boolean remote, JSONObject scope, String action) {
        JSONObject event = new JSONObject();
        event.put("type", "GROUP_CHAT_EVENT");
        event.put("event", "HUMAN_TASK_CHANGED");
        event.put("sessionId", scope.getString("groupSessionId"));
        event.put("batchId", scope.getString("batchId"));
        event.put("humanTaskId", scope.getString("humanTaskId"));
        event.put("change", action);
        event.put("status", scope.getString("status"));
        event.put("revision", scope.getLong("revision"));
        event.put("cardMessageId", scope.getString("cardMessageId"));
        event.put("proposalMessageId", scope.getString("proposalMessageId"));
        // This invalidates an existing card without creating another group timeline message or exposing submission content.
        Runnable send = ()-> {
            try {
                if (remote)events.publishTenant(tenant, scope.getLong("groupSessionId"), event);
                else events.publish(scope.getLong("groupSessionId"), event, null);
            }
            catch (RuntimeException ignored) {
                /* Reconnection reads authoritative state after best-effort delivery. */
            }
        };
        if (TransactionSynchronizationManager.isSynchronizationActive())TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override public void afterCommit() {
                send.run();
            }
        });
        else send.run();
    }

    private static JSONObject object(String key, Long id) {
        JSONObject b = new JSONObject();
        b.put(key, id.toString());
        return b;
    }

    private static JSONObject copy(JSONObject b) {
        return b == null?new JSONObject():JSON.parseObject(b.toJSONString());
    }
}
