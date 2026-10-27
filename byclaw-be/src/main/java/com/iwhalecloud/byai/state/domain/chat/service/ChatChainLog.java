package com.iwhalecloud.byai.state.domain.chat.service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.dto.ChatChainContext;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContextHolder;
import com.iwhalecloud.byai.common.log.util.RequestContextUtil;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
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
        if (dto.getChatChainContext() != null) return dto.getChatChainContext().requestId();
        Object id = dto.getExtParams() == null ? null : dto.getExtParams().get("requestId");
        String root = identity(id);
        return root.isBlank() ? identity(dto.getClientRequestId()) : root;
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

    private static String identity(Object value) {
        String text = value instanceof String || value instanceof Number ? String.valueOf(value) : "";
        return text.matches("[A-Za-z0-9_.:-]{1,128}") ? text : "";
    }

    /** Preserve a valid client correlation id, but never use it as a unique invocation identity. */
    public static ChatChainContext begin(AssistantChatDto dto) {
        if (dto.getChatChainContext() == null) {
            String request = requestId(dto);
            var tenant = TenantRequestContextHolder.get();
            var user = CurrentUserHolder.getLoginInfo();
            dto.setChatChainContext(new ChatChainContext(
                request.isBlank() ? UUID.randomUUID().toString() : request,
                UUID.randomUUID().toString(), tenant == null ? "" : Long.toString(tenant.enterpriseId()),
                tenant == null ? "personal" : "tenant", user == null ? "" : safe(user.getUserCode()),
                safe(RequestContextUtil.getRequestId()), System.nanoTime()));
        }
        return dto.getChatChainContext();
    }

    public static void accept(AssistantChatDto dto, Object... fields) {
        if (dto.getChatChainContext() != null) return;
        begin(dto);
        stage(dto, dto.getTraceId(), "be.received", "point", "ok", 0, fields);
    }

    /** Fresh immutable-by-convention snapshot per publish; retries must not mutate earlier attempts. */
    public static Map<String, Object> dispatchIdentity(AssistantChatDto dto, int attempt) {
        ChatChainContext chain = begin(dto);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("schemaVersion", 1);
        result.put("requestId", chain.requestId());
        result.put("invocationId", chain.invocationId());
        result.put("tenantId", chain.tenantId());
        result.put("scope", chain.scope());
        result.put("userCode", chain.userCode());
        result.put("ingressRequestId", chain.ingressRequestId());
        result.put("dispatchId", UUID.randomUUID().toString());
        result.put("attempt", attempt);
        return result;
    }

    public static void stage(AssistantChatDto dto, String traceId, String stage, String phase,
                             String result, long startedNanos, Object... fields) {
        try {
            ChatChainContext chain = begin(dto);
            JSONObject entry = new JSONObject(true);
            entry.put("time", System.currentTimeMillis());
            entry.put("service", "be");
            entry.put("instance", INSTANCE);
            entry.put("requestId", chain.requestId());
            entry.put("invocationId", chain.invocationId());
            entry.put("ingressRequestId", chain.ingressRequestId());
            entry.put("tenantId", chain.tenantId());
            entry.put("scope", chain.scope());
            entry.put("userCode", chain.userCode());
            entry.put("sessionId", safe(dto.getSessionId()));
            entry.put("traceId", safe(traceId));
            entry.put("clientRequestId", safe(dto.getClientRequestId()));
            entry.put("stage", stage);
            entry.put("phase", phase);
            entry.put("result", result);
            entry.put("elapsedMs", elapsed(chain.startedNanos()));
            if ("end".equals(phase)) entry.put("durationMs", elapsed(startedNanos));
            for (int i = 0; i + 1 < fields.length; i += 2) {
                Object value = fields[i + 1];
                entry.put(String.valueOf(fields[i]), value instanceof Number || value instanceof Boolean ? value : safe(value));
            }
            if ("failed".equals(result)) LOG.warn("chat_chain {}", entry.toJSONString());
            else LOG.info("chat_chain {}", entry.toJSONString());
        } catch (RuntimeException ignored) { /* Diagnostics must not affect delivery. */ }
    }

    private static long elapsed(long start) {
        return Math.max(0, (System.nanoTime() - start) / 1_000_000);
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
            for (int i = 0; i + 1 < fields.length; i += 2) {
                Object value = fields[i + 1];
                entry.put(String.valueOf(fields[i]), value instanceof Number || value instanceof Boolean ? value : safe(value));
            }
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
        if (text == null || (!text.contains("appStreamResponse") && !text.contains("\"error\"") && !text.contains("\"chatChain\""))) return null;
        try {
            JSONObject frame = JSON.parseObject(text);
            if (!ChatReplyLog.checkpoint(frame)) return null;
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
        if (ChatReplyLog.envelope(frame) != null) {
            future.addListener(done -> ChatReplyLog.log("be.ws_written", frame, null,
                done.isSuccess() ? "ok" : "failed", "channelId", future.channel().id().asShortText(),
                "durationMs", elapsed(started), "frameSessionId", frame.get("sessionId"),
                "frameClientRequestId", frame.get("clientRequestId"), "targetTenantId",
                future.channel().attr(com.iwhalecloud.byai.state.domain.ws.constant.Constant.ATT_ENTERPRISE_ID).get()));
            return;
        }
        future.addListener(done -> record("be.ws_written", requestId(frame), frame.get("sessionId"),
            done.isSuccess() ? "ok" : "failed", "channelId", future.channel().id().asShortText(),
            "writeMs", (System.nanoTime() - started) / 1_000_000,
            "errorType", done.cause() == null ? "" : done.cause().getClass().getSimpleName()));
    }
    public static void wsUnavailable(Channel channel, JSONObject frame) {
        if (frame != null && ChatReplyLog.envelope(frame) != null) {
            ChatReplyLog.log("be.ws_written", frame, null, "inactive", "channelId", channel.id().asShortText());
            return;
        }
        if (frame != null) record("be.ws_written", requestId(frame), frame.get("sessionId"), "inactive",
            "channelId", channel.id().asShortText());
    }
}
