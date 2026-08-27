package com.iwhalecloud.byai.state.domain.ws.service;

import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSONObject;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.state.domain.taskplan.dto.TaskPlanSnapshot;

import io.netty.channel.Channel;

/** 把任务计划完整快照投影到现有用户 WebSocket 通道。 */
@Service
public class TaskPlanWebSocketPublisher {

    public static final String MESSAGE_TYPE = "TASK_PLAN_SNAPSHOT";

    private final MultiDeviceBroadcastService broadcastService;

    private final ObjectMapper objectMapper;

    public TaskPlanWebSocketPublisher(MultiDeviceBroadcastService broadcastService, ObjectMapper objectMapper) {
        this.broadcastService = broadcastService;
        this.objectMapper = objectMapper;
    }

    public int broadcast(Long userId, TaskPlanSnapshot snapshot, String clientRequestId) {
        if (snapshot == null) {
            return 0;
        }
        return broadcastService.broadcastRawToUser(userId, frame(snapshot, clientRequestId));
    }

    public JSONObject frame(TaskPlanSnapshot snapshot, String clientRequestId) {
        JSONObject message = new JSONObject();
        message.put("type", MESSAGE_TYPE);
        message.put("schemaVersion", TaskPlanSnapshot.SCHEMA_VERSION);
        message.put("clientRequestId", clientRequestId);
        message.put("sessionId", snapshot == null ? null : snapshot.getSessionId());
        message.put("messageId", snapshot == null ? null : snapshot.getMessageId());
        message.put("turnId", snapshot == null ? null : snapshot.getTurnId());
        message.put("laneId", snapshot == null ? null : snapshot.getLaneId());
        message.put("traceId", snapshot == null ? null : snapshot.getTraceId());
        message.put("data", snapshot == null ? null : snapshotJson(snapshot));
        return message;
    }

    public void send(Channel channel, TaskPlanSnapshot snapshot, String clientRequestId, String sessionId,
        String messageId) {
        if (channel == null || !channel.isActive()) {
            return;
        }
        JSONObject frame = snapshot == null ? emptyFrame(clientRequestId, sessionId, messageId)
            : frame(snapshot, clientRequestId);
        channel.writeAndFlush(new io.netty.handler.codec.http.websocketx.TextWebSocketFrame(frame.toJSONString()));
    }

    private JSONObject emptyFrame(String clientRequestId, String sessionId, String messageId) {
        JSONObject message = new JSONObject();
        message.put("type", MESSAGE_TYPE);
        message.put("schemaVersion", TaskPlanSnapshot.SCHEMA_VERSION);
        message.put("clientRequestId", clientRequestId);
        message.put("sessionId", sessionId);
        message.put("messageId", messageId);
        message.put("data", null);
        return message;
    }

    private JSONObject snapshotJson(TaskPlanSnapshot snapshot) {
        try {
            // 与 HTTP 返回共用 Jackson 配置，确保 @JsonFormat 时间字段在 WS 中也是 ISO 字符串。
            return JSONObject.parseObject(objectMapper.writeValueAsString(snapshot));
        }
        catch (JsonProcessingException e) {
            throw new IllegalStateException("Unable to serialize task plan snapshot", e);
        }
    }
}
