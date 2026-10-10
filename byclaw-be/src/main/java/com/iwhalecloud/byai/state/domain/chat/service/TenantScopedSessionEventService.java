package com.iwhalecloud.byai.state.domain.chat.service;

import java.util.List;
import java.util.Map;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.time.Duration;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.Fields;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContext;
import com.iwhalecloud.byai.state.common.dto.AnswerDelta;
import com.iwhalecloud.byai.state.common.enums.AgentTypeEnum;
import com.iwhalecloud.byai.state.domain.chat.model.MessageContext;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

/** Routes external projections through the owning tenant Node. */
@Service
public class TenantScopedSessionEventService {
    private static final String OWNER_KEY = "byclaw:tenant:projection-owner:";
    private final TenantNodeClient node;
    private final StringRedisTemplate redis;
    private final PythonSseService sse;
    private final GatewayStreamEventProcessor processor;
    private final ScopedProjectionBroadcaster broadcaster;

    public TenantScopedSessionEventService(TenantNodeClient node, StringRedisTemplate redis,
        PythonSseService sse, GatewayStreamEventProcessor processor, ScopedProjectionBroadcaster broadcaster) {
        this.node = node; this.redis = redis; this.sse = sse;
        this.processor = processor; this.broadcaster = broadcaster;
    }

    /** Register trusted ownership before dispatch, retaining it beyond the foreground run for late children. */
    public void remember(Long sessionId, TenantRequestContext tenant) {
        String key = OWNER_KEY + sessionId;
        String value = JSON.toJSONString(tenant);
        if (!Boolean.TRUE.equals(redis.opsForValue().setIfAbsent(key, value, Duration.ofDays(30)))) {
            TenantRequestContext previous = owner(sessionId);
            if (previous == null || previous.enterpriseId() != tenant.enterpriseId() || previous.userId() != tenant.userId())
                throw new IllegalStateException("tenant projection ownership mismatch");
            redis.expire(key, Duration.ofDays(30));
        }
    }

    TenantRequestContext owner(Long sessionId) {
        String stored = redis.opsForValue().get(OWNER_KEY + sessionId);
        if (stored == null) return null;
        return JSON.parseObject(stored, TenantRequestContext.class);
    }

    /** null means personal routing; false means tenant root/team routing may continue. */
    public Boolean handleIfNecessary(Long parentId, JSONObject event) {
        JSONObject metadata = event == null ? null : event.getJSONObject("metadata");
        String scope = metadata == null ? null : metadata.getString("session_scope");
        // Terminal root events may carry metadata without a session scope.
        if (!"child".equals(scope) && !"team".equals(scope))
            return owner(parentId) == null ? null : false;
        TenantRequestContext tenant = owner(parentId);
        if (tenant == null) return null;
        if ("child".equals(metadata.getString("session_scope"))) {
            project(tenant, parentId, List.of(event));
            return true;
        }
        enrichTeam(tenant, parentId, event, metadata);
        return false;
    }

    public boolean handleChildBatch(Long parentId, List<JSONObject> events) {
        TenantRequestContext tenant = owner(parentId);
        if (tenant == null) return false;
        if (!events.isEmpty()) project(tenant, parentId, events);
        return true;
    }

    private JSONObject binding(TenantRequestContext tenant, Long parentId, JSONObject metadata) {
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("externalSessionId", metadata.getString("external_session_id"));
        fields.put("externalRootSessionId", metadata.getString("external_root_session_id"));
        copy(fields, "externalParentSessionId", metadata, "external_parent_session_id");
        copy(fields, "childName", metadata, "child_name");
        copy(fields, "childRole", metadata, "child_role");
        copy(fields, "childTask", metadata, "child_task");
        var result = node.command(tenant, "POST", "/internal/v1/sessions/" + parentId + "/external-children",
            parentId.toString(), "ENSURE_EXTERNAL_CHILD", new Fields(fields));
        if (result == null || result.data() == null) throw new IllegalStateException("missing tenant child binding");
        return JSON.parseObject(result.data().toString());
    }

    private void project(TenantRequestContext tenant, Long parentId, List<JSONObject> events) {
        JSONObject metadata = events.getFirst().getJSONObject("metadata");
        JSONObject bound = binding(tenant, parentId, metadata);
        JSONObject session = bound.getJSONObject("session"), stored = bound.getJSONObject("message");
        JSONObject previous = JSON.parseObject(stored.getString("metadata"));
        if (previous == null) previous = new JSONObject();
        String initialWatermark = previous.getString("event_stream_id");
        String watermark = initialWatermark;
        Long oldTurn = previous.getLong("child_turn"), newTurn = metadata.getLong("child_turn");
        boolean newer = oldTurn != null && newTurn != null && newTurn > oldTurn;
        if (oldTurn != null && newTurn != null && (newTurn < oldTurn
            || newTurn.equals(oldTurn) && previous.getString("child_run_id") != null
                && !java.util.Objects.equals(previous.getString("child_run_id"), metadata.getString("child_run_id")))) return;
        MessageContext message = new MessageContext(AgentTypeEnum.AGENT, stored.getLong("messageId"));
        if (!newer) {
            restore(message.getAnswerMessageList(), stored.getString("messageStruct"));
            restore(message.getReasonMessageList(), stored.getString("inferLog"));
            message.restoreSegmentCursor();
            message.setExplicitFinalAnswer(stored.getString("finalContent"));
            message.setComplete(Boolean.TRUE.equals(stored.getBoolean("isComplete")));
        }
        LinkedHashSet<String> sequences = new LinkedHashSet<>();
        JSONArray recent = newer ? null : previous.getJSONArray("tenant_recent_sequences");
        if (recent != null) for (Object value : recent) sequences.add(value.toString());
        ChatProcessContext context = new ChatProcessContext(null, null);
        context.sessionId = session.getLong("sessionId"); context.userMessageId = 0L;
        JSONObject last = null;
        for (JSONObject event : events) {
            JSONObject current = event.getJSONObject("metadata");
            if (!java.util.Objects.equals(metadata.getString("external_session_id"), current.getString("external_session_id")))
                throw new IllegalArgumentException("mixed child event batch");
            if (!java.util.Objects.equals(metadata.getString("child_run_id"), current.getString("child_run_id"))
                || !java.util.Objects.equals(metadata.getString("child_turn"), current.getString("child_turn")))
                throw new IllegalArgumentException("mixed child run batch");
            String stream = event.getString("stream_id");
            if (stream == null || !stream.matches("\\d+-\\d+")) throw new IllegalArgumentException("child stream ID required");
            if (StreamIdUtil.isProcessedByWatermark(stream, watermark)) continue;
            String sequence = current.getString("event_sequence");
            String logical = sequence == null ? null : current.getString("event_kind") + ":" + sequence;
            if (!Boolean.TRUE.equals(message.getComplete()) && (logical == null || sequences.add(logical))) {
                JSONObject line = new JSONObject();
                line.put("event", event.getString("event_type"));
                line.put("data", processor.buildEventData(context, event, current));
                sse.accumulateEvent(line.toJSONString(), message);
            }
            if (terminal(event, current)) message.setComplete(true);
            watermark = stream; last = event;
        }
        if (last == null) return;
        while (sequences.size() > 512) sequences.remove(sequences.getFirst());
        JSONObject persistedMetadata = new JSONObject(new LinkedHashMap<>(last.getJSONObject("metadata")));
        persistedMetadata.put("external_parent_session_id", parentId.toString());
        persistedMetadata.put("event_source", "EXTERNAL_CHILD");
        if (java.util.stream.Stream.concat(message.getAnswerMessageList().stream(), message.getReasonMessageList().stream())
            .anyMatch(segment -> segment.getSeq() != null)) persistedMetadata.put("messageRenderVersion", "v2");
        persistedMetadata.put("tenant_recent_sequences", sequences);
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("childSessionId", session.getString("sessionId")); fields.put("messageId", stored.getString("messageId"));
        fields.put("expectedStreamId", initialWatermark); fields.put("streamId", watermark);
        String finalBody = message.getExplicitFinalAnswer();
        fields.put("messageContent", finalBody == null ? TenantChatMirrorService.visibleText(message) : finalBody);
        fields.put("finalContent", finalBody);
        fields.put("messageStruct", message.getAnswerMessageList()); fields.put("inferLog", message.getReasonMessageList());
        fields.put("metadata", persistedMetadata); fields.put("complete", Boolean.TRUE.equals(message.getComplete()));
        var result = node.command(tenant, "POST", "/internal/v1/sessions/" + parentId + "/external-child-projection",
            parentId.toString(), "SAVE_EXTERNAL_CHILD", new Fields(fields),
            "child-" + hash(session.getString("sessionId") + ":" + watermark));
        if (result == null || result.data() == null) throw new IllegalStateException("missing child commit");
        JSONObject committed = JSON.parseObject(result.data().path("message").toString());
        JSONObject notification = new JSONObject();
        notification.put("type", "NEW_MESSAGE"); notification.put("sessionId", session.getString("sessionId"));
        notification.put("streamId", watermark); notification.put("data", committed);
        broadcaster.enqueueTenant("tenant:" + tenant.enterpriseId() + ":" + session.getString("sessionId"),
            tenant.userId(), tenant.enterpriseId(), notification, Boolean.TRUE.equals(message.getComplete()));
    }

    private void enrichTeam(TenantRequestContext tenant, Long parentId, JSONObject event, JSONObject metadata) {
        JSONObject answer = JSON.parseObject(event.getString("data"));
        if (answer == null || answer.getJSONArray("choices") == null || answer.getJSONArray("choices").isEmpty()) return;
        JSONObject delta = answer.getJSONArray("choices").getJSONObject(0).getJSONObject("delta");
        if (delta == null) return;
        JSONObject card = JSON.parseObject(delta.getString("content"));
        if (card == null || !"agent-teams/snapshot".equals(card.getString("eventKind"))) return;
        JSONArray members = card.getJSONObject("team") == null ? null : card.getJSONObject("team").getJSONArray("members");
        if (members == null) return;
        for (Object value : members) {
            JSONObject member = (JSONObject) value;
            if (member.getString("id") == null || member.getString("id").equals(metadata.getString("external_root_session_id"))) continue;
            JSONObject child = new JSONObject(new LinkedHashMap<>(metadata));
            child.put("external_session_id", member.getString("id")); child.put("child_name", member.getString("name"));
            child.put("child_role", member.getString("role")); child.put("child_task", member.getString("currentTask"));
            member.put("byclawSessionId", binding(tenant, parentId, child).getJSONObject("session").getString("sessionId"));
        }
        delta.put("content", card.toJSONString()); event.put("data", answer.toJSONString());
    }

    private static void copy(Map<String, Object> fields, String key, JSONObject metadata, String source) {
        if (metadata.getString(source) != null) fields.put(key, metadata.getString(source));
    }
    private static void restore(List<AnswerDelta> target, String value) {
        if (value != null && !value.isBlank()) target.addAll(JSON.parseArray(value, AnswerDelta.class));
    }
    private static boolean terminal(JSONObject event, JSONObject metadata) {
        String kind = metadata.getString("event_kind");
        String status = metadata.getString("session_status");
        return List.of("appStreamResponse", "error").contains(event.getString("event_type"))
            || List.of("session.error", "error").contains(kind == null ? "" : kind)
            || "session.status".equals(kind) && status != null
                && List.of("completed", "failed", "cancelled", "canceled", "stopped", "error").contains(status.toLowerCase(Locale.ROOT));
    }
    private static String hash(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))).substring(0, 40); }
        catch (java.security.NoSuchAlgorithmException error) { throw new IllegalStateException(error); }
    }
}
