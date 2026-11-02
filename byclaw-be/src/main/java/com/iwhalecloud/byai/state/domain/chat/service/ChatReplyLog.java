package com.iwhalecloud.byai.state.domain.chat.service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.ws.manager.NettyArrayOutputStream;
import java.util.ArrayList;
import java.util.List;

/** Diagnostics only. Origin identity and actual routing destination must never overwrite each other. */
public final class ChatReplyLog {
    private static final List<String> FIELDS = List.of("requestId", "invocationId", "dispatchId", "deliveryId",
        "startupId", "ingressRequestId", "tenantId", "scope", "identitySource", "sessionId", "traceId", "messageId",
        "replyEventId", "eventType", "eventSessionId", "eventTraceId", "eventMessageId", "parentMessageId",
        "externalSessionId", "sessionScope", "workerId", "eventSequence", "checkpoint", "streamId",
        "targetSessionId", "targetTraceId", "targetMessageId", "targetClientRequestId", "targetInvocationId",
        "frameId", "frameClientRequestId", "targetTenantId", "eventKind");
    private ChatReplyLog() { }

    public static void streamRecord(String stage, org.springframework.data.redis.connection.stream.MapRecord<?, ?, ?> record,
                                    String result, long started) {
        try {
            JSONObject event = object(record.getValue().get("data"));
            if (event == null) return;
            event.put("stream_id", record.getId().getValue());
            log(stage, event, null, result, "streamKey", record.getStream(),
                "durationMs", (System.nanoTime() - started) / 1_000_000);
        } catch (RuntimeException ignored) { /* Diagnostics never affect ACKs. */ }
    }

    public static JSONObject object(Object value) {
        try {
            return value instanceof JSONObject json ? json : value instanceof String text ? JSON.parseObject(text) : null;
        } catch (RuntimeException ignored) { return null; }
    }

    public static JSONObject safeEnvelope(Object value) {
        JSONObject input = object(value);
        if (input == null || input.getString("invocationId") == null) return null;
        JSONObject result = new JSONObject(true);
        for (String field : FIELDS) {
            Object item = input.get(field);
            if (item instanceof Number || item instanceof Boolean) result.put(field, item);
            else if (item instanceof String) result.put(field, ChatChainLog.safe(item));
        }
        return result;
    }

    public static JSONObject envelope(JSONObject frame) {
        JSONObject cursor = frame;
        for (int depth = 0; cursor != null && depth < 4; depth++) {
            JSONObject found = safeEnvelope(cursor.get("chatChain"));
            if (found != null) return found;
            JSONObject metadata = object(cursor.get("metadata"));
            found = metadata == null ? null : safeEnvelope(metadata.get("chatChain"));
            if (found != null) return found;
            cursor = object(cursor.get("data"));
        }
        return null;
    }

    public static boolean checkpoint(JSONObject event) {
        JSONObject chain = envelope(event);
        String type = event == null ? null : event.getString("event_type");
        if (type == null && event != null) type = event.getString("event");
        return ChatChainLog.terminal(event) || "finalAnswer".equals(type) || "final_answer".equals(type)
            || chain != null && Boolean.TRUE.equals(chain.getBoolean("checkpoint"));
    }

    public static String frame(String text) {
        JSONObject frame = object(text);
        return prepareFrame(frame) ? frame.toJSONString() : text;
    }

    public static boolean prepareFrame(JSONObject frame) {
        JSONObject chain = envelope(frame);
        if (chain == null) return false;
        if (chain.getString("frameId") == null) chain.put("frameId", java.util.UUID.randomUUID().toString());
        chain.put("targetSessionId", frame.getString("sessionId"));
        if (frame.getString("streamId") != null) chain.put("streamId", frame.getString("streamId"));
        chain.put("frameClientRequestId", frame.getString("clientRequestId"));
        chain.put("targetTenantId", frame.getString("enterpriseId"));
        JSONObject data = object(frame.get("data"));
        if (data != null && data.getString("messageId") != null) chain.put("targetMessageId", data.getString("messageId"));
        frame.put("chatChain", chain);
        return true;
    }

    public static JSONObject bind(ChatProcessContext ctx, JSONObject event) {
        try { return bindInternal(ctx, event); } catch (RuntimeException ignored) { return null; }
    }

    private static JSONObject bindInternal(ChatProcessContext ctx, JSONObject event) {
        JSONObject chain = envelope(event);
        if (chain == null || ctx == null) return chain;
        chain.put("streamId", event.getString("stream_id"));
        chain.put("targetSessionId", ChatChainLog.safe(ctx.sessionId));
        String trace = event.getString("trace_id");
        chain.put("targetTraceId", trace);
        var message = ctx.resolveMessageContext(trace);
        String messageId = message == null ? "" : ChatChainLog.safe(message.getMessageId());
        chain.put("targetMessageId", messageId);
        JSONObject lane = trace == null ? null : ctx.getMultiAgentLaneMetadata(trace);
        chain.put("targetClientRequestId", lane != null && lane.getString("clientRequestId") != null
            ? lane.getString("clientRequestId") : ctx.clientRequestId);
        if (ctx.assistantChatDto != null && ctx.assistantChatDto.getChatChainContext() != null)
            chain.put("targetInvocationId", ctx.assistantChatDto.getChatChainContext().invocationId());
        event.put("chatChain", new JSONObject(chain));
        if (trace != null && (ctx.replyDiagnosticsByTrace.size() < 128 || ctx.replyDiagnosticsByTrace.containsKey(trace)))
            ctx.replyDiagnosticsByTrace.put(trace, new JSONObject(chain));
        if (ctx.res instanceof NettyArrayOutputStream stream) stream.registerReply(trace, messageId, chain);
        return chain;
    }

    public static void attach(JSONObject frame, ChatProcessContext ctx, String traceId) {
        if (frame == null || ctx == null || traceId == null) return;
        JSONObject chain = ctx.replyDiagnosticsByTrace.get(traceId);
        if (chain != null) frame.put("chatChain", new JSONObject(chain));
    }

    public static void log(String stage, JSONObject event, ChatProcessContext ctx, String result, Object... extra) {
        try { logInternal(stage, event, ctx, result, extra); } catch (RuntimeException ignored) { }
    }

    private static void logInternal(String stage, JSONObject event, ChatProcessContext ctx, String result, Object... extra) {
        if (!checkpoint(event)) return;
        JSONObject chain = envelope(event);
        if (chain == null) chain = new JSONObject();
        if (ctx != null && event.getString("trace_id") != null) {
            JSONObject routed = ctx.replyDiagnosticsByTrace.get(event.getString("trace_id"));
            if (routed != null) for (String field : FIELDS) {
                if (field.startsWith("target") && routed.containsKey(field)) chain.put(field, routed.get(field));
            }
        }
        List<Object> fields = new ArrayList<>();
        for (String field : FIELDS) if (chain.containsKey(field)) { fields.add(field); fields.add(chain.get(field)); }
        fields.add("eventType"); fields.add(event.getString("event_type") == null ? event.getString("event") : event.getString("event_type"));
        fields.add("eventSessionId"); fields.add(event.getString("session_id") == null ? chain.get("eventSessionId") : event.getString("session_id"));
        fields.add("streamId"); fields.add(event.getString("stream_id") == null ? chain.get("streamId") : event.getString("stream_id"));
        if (ctx != null) {
            fields.add("actualContextSessionId"); fields.add(ctx.sessionId);
            fields.add("actualContextTraceId"); fields.add(ctx.traceId);
        }
        fields.addAll(java.util.Arrays.asList(extra));
        ChatChainLog.record(stage, chain.getString("requestId") == null ? ChatChainLog.requestId(event) : chain.getString("requestId"),
            ctx == null ? event.get("session_id") : ctx.sessionId, result, fields.toArray());
    }
}
