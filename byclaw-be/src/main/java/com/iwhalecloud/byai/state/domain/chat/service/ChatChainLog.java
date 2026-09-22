package com.iwhalecloud.byai.state.domain.chat.service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import io.netty.channel.Channel;
import io.netty.channel.ChannelFuture;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Key delivery checkpoints only. Never log message bodies, headers or credentials. */
public final class ChatChainLog {
    private static final Logger LOG = LoggerFactory.getLogger(ChatChainLog.class);
    private static final String INSTANCE = ProcessHandle.current().pid() + "@" +
        System.getenv().getOrDefault("HOSTNAME", "local");
    private ChatChainLog() { }

    public static String requestId(AssistantChatDto dto) {
        if (dto == null) return "";
        Object id = dto.getExtParams() == null ? null : dto.getExtParams().get("requestId");
        return safe(id == null ? dto.getClientRequestId() : id);
    }
    public static String requestId(ChatProcessContext ctx) {
        if (ctx == null) return "";
        String id = requestId(ctx.assistantChatDto);
        return id.isBlank() ? safe(ctx.traceId) : id;
    }
    public static String requestId(JSONObject event) {
        try {
            if (event == null) return "";
            JSONObject metadata = event.getJSONObject("metadata");
            Object id = event.get("requestId");
            if (id == null && metadata != null) id = metadata.get("requestId");
            if (id == null) id = event.get("trace_id");
            if (id == null) id = event.get("clientRequestId");
            return safe(id);
        } catch (RuntimeException ignored) { return ""; }
    }
    public static String safe(Object value) {
        if (!(value instanceof String) && !(value instanceof Number) && !(value instanceof Boolean)) return "";
        String text = String.valueOf(value).replaceAll("[\\r\\n\\t]", "_");
        return text.substring(0, Math.min(160, text.length()));
    }

    public static void record(String stage, String requestId, Object sessionId, String result, Object... fields) {
        try {
            JSONObject entry = new JSONObject(true);
            entry.put("time", System.currentTimeMillis());
            entry.put("service", "be");
            entry.put("instance", INSTANCE);
            entry.put("requestId", safe(requestId));
            entry.put("sessionId", safe(sessionId));
            entry.put("stage", stage);
            entry.put("result", result);
            for (int i = 0; i + 1 < fields.length; i += 2) entry.put(String.valueOf(fields[i]), safe(fields[i + 1]));
            if ("ok".equals(result)) LOG.info("chat_chain {}", entry.toJSONString());
            else LOG.warn("chat_chain {}", entry.toJSONString());
        } catch (RuntimeException ignored) { /* Diagnostics must not affect delivery. */ }
    }
    public static boolean terminal(JSONObject event) {
        if (event == null) return false;
        String type = event.getString("event");
        if (type == null) type = event.getString("event_type");
        return "appStreamResponse".equals(type) || "error".equals(type);
    }
    public static JSONObject terminalFrame(String text) {
        if (text == null || (!text.contains("appStreamResponse") && !text.contains("\"error\""))) return null;
        try {
            JSONObject frame = JSON.parseObject(text);
            if (!terminal(frame)) return null;
            try {
                JSONObject data = frame.getJSONObject("data");
                String rootId = requestId(data);
                if (!frame.containsKey("requestId") && !rootId.isBlank()) frame.put("requestId", rootId);
            } catch (RuntimeException ignored) { /* Some terminal bodies are plain text. */ }
            return frame;
        } catch (RuntimeException ignored) { return null; }
    }
    public static void received(org.springframework.data.redis.connection.stream.MapRecord<?, ?, ?> record) {
        try {
            Object raw = record.getValue().get("data");
            if (raw == null || (!raw.toString().contains("appStreamResponse") && !raw.toString().contains("\"error\""))) return;
            JSONObject event = JSON.parseObject(raw.toString());
            if (terminal(event)) record("be.final_received", requestId(event), event.get("session_id"), "ok",
                "streamId", record.getId().getValue(), "traceId", event.get("trace_id"), "source", "listener");
        } catch (RuntimeException ignored) { }
    }
    public static void wsWritten(ChannelFuture future, JSONObject frame, long started) {
        if (frame == null) return;
        future.addListener(done -> record("be.ws_written", requestId(frame), frame.get("sessionId"),
            done.isSuccess() ? "ok" : "failed", "channelId", future.channel().id().asShortText(),
            "writeMs", (System.nanoTime() - started) / 1_000_000,
            "errorType", done.cause() == null ? "" : done.cause().getClass().getSimpleName()));
    }
    public static void wsUnavailable(Channel channel, JSONObject frame) {
        if (frame != null) record("be.ws_written", requestId(frame), frame.get("sessionId"), "inactive",
            "channelId", channel.id().asShortText());
    }
}
