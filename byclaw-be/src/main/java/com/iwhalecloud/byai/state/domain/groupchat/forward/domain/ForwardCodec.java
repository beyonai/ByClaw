package com.iwhalecloud.byai.state.domain.groupchat.forward.domain;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import static com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;

/** Strict client input parsing and cross-runtime canonical request hashing. */
public final class ForwardCodec {
    /** Byte counts and durations are numeric protocol values; IDs remain decimal strings. */
    public static final class LongNumberSerializer extends com.fasterxml.jackson.databind.JsonSerializer<Long> {
        @Override public void serialize(Long value, com.fasterxml.jackson.core.JsonGenerator output,
                com.fasterxml.jackson.databind.SerializerProvider provider) throws java.io.IOException { output.writeNumber(value); }
    }
    private static final ObjectMapper JSON = new ObjectMapper();
    public ForwardInput readInput(String json) {
        try {
            JsonNode root = JSON.readTree(json);
            Set<String> allowed = Set.of("clientRequestId", "mode", "messageIds", "targetSessionIds");
            if (root == null || !root.isObject()) throw invalid();
            root.fieldNames().forEachRemaining(key -> { if (!allowed.contains(key)) throw invalid(); });
            if (!root.path("clientRequestId").isTextual() || !root.path("mode").isTextual()) throw invalid();
            return new ForwardInput(root.get("clientRequestId").textValue(), ForwardMode.valueOf(root.get("mode").textValue()),
                    readIds(root.get("messageIds")), readIds(root.get("targetSessionIds")));
        } catch (Exception exception) { throw invalid(); }
    }
    /** Retry may select existing target groups only; actor and routing identity are server-owned. */
    public Set<Long> readRetry(String json) {
        try {
            var root=JSON.readTree(json);
            if(root==null || !root.isObject() || root.size()!=1 || !root.has("targetSessionIds"))throw invalid();
            var ids=readIds(root.get("targetSessionIds"));
            if(ids.isEmpty() || ids.size()>10)throw invalid();
            return Set.copyOf(ids);
        } catch(Exception error) { throw invalid(); }
    }
    private List<Long> readIds(JsonNode node) {
        if (node == null || !node.isArray()) throw invalid();
        List<Long> result = new ArrayList<>();
        node.forEach(id -> { if (!id.isTextual()) throw invalid(); result.add(parseId(id.textValue())); });
        return result;
    }
    public static long parseId(String value) {
        if (value == null || !value.matches("[1-9][0-9]*")) throw invalid();
        try { return Long.parseLong(value); } catch (NumberFormatException exception) { throw invalid(); }
    }
    public String canonicalHash(ForwardActor actor, long sourceId, ForwardInput input) {
        requireId(sourceId);
        try {
            var payload = List.of("byclaw.group-forward/v1", Long.toString(actor.enterpriseId()), Long.toString(actor.userId()),
                    Long.toString(sourceId), input.mode().name(), input.messageIds().stream().map(String::valueOf).toList(), input.targetSessionIds().stream().map(String::valueOf).toList());
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(JSON.writeValueAsString(payload).getBytes(StandardCharsets.UTF_8)));
        } catch (Exception exception) { throw new IllegalStateException("FORWARD_ENCODING_FAILED", exception); }
    }
    static byte[] jsonBytes(Object value) {
        try { return JSON.writeValueAsBytes(value); } catch (Exception exception) { throw new IllegalArgumentException("FORWARD_ENCODING_FAILED", exception); }
    }
}
