package com.iwhalecloud.byai.state.domain.groupchat.infrastructure;

import java.util.List;
import java.util.Map;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.constants.groupchat.GroupResponsePhase;

/** 从执行行生成字段白名单群视图；创建者 Codex，2026-11-13。 */
public final class GroupChatResponseProjection {
    private GroupChatResponseProjection() { }

    /** 候选正文与运行身份永不进入公共投影。 */
    public static JSONObject view(Map<String, Object> row) {
        JSONObject view = new JSONObject();
        for (String field : List.of("responseId", "groupSessionId", "sourceMessageId", "targetAgentId", "initiatorUserId")) {
            view.put(field, string(row.get(field)));
        }
        view.put("agentName", row.getOrDefault("agentName", "数字员工"));
        view.put("createdAt", row.get("createTime"));
        view.put("sourceCreatedAt", row.get("sourceCreateTime"));
        view.put("disposition", row.getOrDefault("disposition", "UNKNOWN"));
        view.put("phase", GroupResponsePhase.QUEUED.equals(row.get("status")) ? GroupResponsePhase.QUEUED : GroupResponsePhase.RUNNING);
        boolean recalled = row.get("sourceRecalledAt") != null;
        JSONObject reply = new JSONObject();
        reply.put("messageId", view.get("sourceMessageId"));
        reply.put("content", recalled ? "消息已撤回" : row.getOrDefault("sourceContent", ""));
        reply.put("resourceList", recalled ? List.of() : metadata(row.get("sourceMetadata")).getOrDefault("resourceList", List.of()));
        reply.put("recalled", recalled);
        JSONObject speaker = new JSONObject();
        speaker.put("type", "USER");
        speaker.put("userId", string(row.get("sourceCreatorId")));
        speaker.put("displayName", row.get("sourceName"));
        reply.put("speaker", speaker);
        view.put("replyTo", reply);
        if (recalled || GroupResponsePhase.CANCELLED.equals(row.get("status"))) {
            view.put("phase", GroupResponsePhase.CANCELLED);
        }
        else if (row.get("taskSessionId") != null) {
            view.put("phase", GroupResponsePhase.TASK);
            view.put("taskSessionId", string(row.get("taskSessionId")));
            JSONObject task = new JSONObject();
            for (String field : List.of("responseId", "groupSessionId", "sourceMessageId", "targetAgentId", "initiatorUserId", "taskSessionId")) {
                task.put(field, view.get(field));
            }
            task.put("taskName", row.get("taskName"));
            task.put("status", row.get("taskStatus"));
            task.put("turnStatus", row.get("taskTurnStatus"));
            task.put("createTime", row.get("createTime"));
            view.put("task", task);
        }
        else if ("SUCCEEDED".equals(row.get("status")) && row.get("resultMessageId") != null) {
            view.put("phase", GroupResponsePhase.CHAT_COMPLETED);
            view.put("resultMessageId", string(row.get("resultMessageId")));
            JSONObject message = new JSONObject();
            for (String field : List.of("responseId", "sourceMessageId", "targetAgentId")) {
                message.put(field, view.get(field));
            }
            message.put("messageId", view.get("resultMessageId"));
            message.put("sessionId", view.get("groupSessionId"));
            message.put("role", "ASSISTANT");
            message.put("content", row.get("resultRecalledAt") == null ? row.get("resultContent") : "消息已撤回");
            message.put("recalled", row.get("resultRecalledAt") != null);
            message.put("replyTo", reply);
            message.put("createTime", row.get("resultCreateTime"));
            message.put("resourceList", row.get("resultRecalledAt") == null ? metadata(row.get("resultMetadata")).get("resourceList") : List.of());
            JSONObject agent = new JSONObject();
            agent.put("type", "AGENT");
            agent.put("agentId", view.get("targetAgentId"));
            agent.put("displayName", view.get("agentName"));
            message.put("speaker", agent);
            view.put("resultMessage", message);
        }
        else if (List.of(GroupResponsePhase.FAILED, "BLOCKED", "SUCCEEDED").contains(string(row.get("status")))) {
            view.put("phase", GroupResponsePhase.FAILED);
        }
        return view;
    }

    private static JSONObject metadata(Object value) {
        return value == null || value.toString().isBlank() ? new JSONObject() : JSON.parseObject(value.toString());
    }

    private static String string(Object value) {
        return value == null ? "" : value.toString();
    }
}
