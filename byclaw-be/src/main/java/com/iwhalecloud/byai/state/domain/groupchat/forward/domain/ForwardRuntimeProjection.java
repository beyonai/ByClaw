package com.iwhalecloud.byai.state.domain.groupchat.forward.domain;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.MissingNode;
import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextResponse;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.ForwardReference;

/** Read-only snapshot projections never confer runtime resource or attachment authority. */
public final class ForwardRuntimeProjection {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Pattern TOKEN = Pattern.compile("\\{\\{([^{}]+)}}");

    private ForwardRuntimeProjection() { }

    public static JsonNode metadata(String value) {
        if (value == null || value.isBlank()) return MissingNode.getInstance();
        try {
            JsonNode parsed = JSON.readTree(value);
            return parsed != null && parsed.isObject() ? parsed : MissingNode.getInstance();
        }
        catch (Exception ignored) {
            return MissingNode.getInstance();
        }
    }

    /** Damaged presentation fields must not downgrade known snapshots to executable resources. */
    public static boolean isSnapshotOnly(JsonNode metadata) {
        return metadata != null && ("SNAPSHOT_ONLY".equals(metadata.path("forward").path("resourceMode").asText())
            || "FORWARD_SINGLE".equals(metadata.path("kind").asText())
            || "FORWARD_MERGED".equals(metadata.path("kind").asText()));
    }

    public static boolean isSnapshotOnly(String metadata) {
        return isSnapshotOnly(metadata(metadata));
    }

    public static String projectPassive(String content, List<ForwardReference> references) {
        if (content == null || content.isEmpty()) return content;
        Map<String, String> names = new LinkedHashMap<>();
        if (references != null) for (ForwardReference ref : references) {
            if (ref != null && ref.id() != null && ref.resourceName() != null) names.putIfAbsent(ref.id(), ref.resourceName());
        }
        Matcher matcher = TOKEN.matcher(content);
        return matcher.replaceAll(match -> Matcher.quoteReplacement(names.getOrDefault(match.group(1), match.group())));
    }

    public static List<ForwardReference> references(JsonNode meta) {
        List<ForwardReference> result = new ArrayList<>();
        if ("FORWARD_MERGED".equals(meta.path("kind").asText())) return result;
        JsonNode values = meta.path("resourceList");
        if (!values.isArray()) return result;
        for (JsonNode ref : values) {
            if (text(ref, "id") != null && text(ref, "resourceName") != null) result.add(new ForwardReference(
                text(ref, "id"), text(ref, "resourceId"), text(ref, "resourceName"), text(ref, "resourceType"), text(ref, "resourceCode"),text(ref,"extData")));
        }
        return result;
    }

    /** Build new compatibility DTOs rather than deserializing old runtime fields. */
    public static List<ResourceVo> displayResources(JsonNode meta) {
        List<ResourceVo> result = new ArrayList<>();
        for (ForwardReference ref : references(meta)) {
            ResourceVo resource = new ResourceVo();
            resource.setId(ref.id()); resource.setResourceId(ref.resourceId()); resource.setResourceName(ref.resourceName());
            try { resource.setResourceType(AgentMetaEnum.valueOf(ref.resourceType())); }
            catch (IllegalArgumentException | NullPointerException ignored) { continue; }
            resource.setResourceCode(ref.resourceCode()); resource.setExtData(ref.extData());
            result.add(resource);
        }
        return result;
    }

    public static String projectMetadata(String content, String metadata) {
        JsonNode meta = metadata(metadata);
        return isSnapshotOnly(meta) ? projectPassive(content, references(meta)) : content;
    }

    /** Public marker/preview only; it is never an authorization lookup key. */
    public static Map<String, Object> publicForward(JsonNode meta) {
        if (!isSnapshotOnly(meta)) return null;
        JsonNode raw = meta.path("forward");
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("resourceMode", "SNAPSHOT_ONLY");
        String id = text(raw, "forwardId");
        if (id != null && id.matches("[1-9]\\d*")) result.put("forwardId", id);
        String mode = text(raw, "mode");
        if ("SINGLE".equals(mode) || "MERGED".equals(mode)) result.put("mode", mode);
        if (raw.path("itemCount").isIntegralNumber() && raw.path("itemCount").canConvertToInt()
            && raw.path("itemCount").intValue() >= 1 && raw.path("itemCount").intValue() <= 100) result.put("itemCount", raw.path("itemCount").intValue());
        if ("FORWARD_MERGED".equals(meta.path("kind").asText())) {
            result.put("title", "聊天记录");
            List<Map<String, String>> preview = new ArrayList<>();
            if (raw.path("preview").isArray()) for (JsonNode entry : raw.path("preview")) {
                if (preview.size() == 3) break;
                String body = entry.path("content").isTextual() ? entry.path("content").textValue() : "";
                body = body.substring(0, body.offsetByCodePoints(0, Math.min(120, body.codePointCount(0, body.length()))));
                preview.add(Map.of("speakerName", entry.path("speakerName").isTextual() ? entry.path("speakerName").textValue() : "", "content", body));
            }
            result.put("preview", preview);
        }
        return result;
    }

    public static boolean isSnapshotOnly(Map<String, Object> forward) {
        return forward != null && "SNAPSHOT_ONLY".equals(forward.get("resourceMode"));
    }

    private static List<ForwardReference> fromDisplay(List<ResourceVo> resources) {
        if (resources == null) return List.of();
        return resources.stream().filter(java.util.Objects::nonNull).map(ref -> new ForwardReference(ref.getId(),
            ref.getResourceId(), ref.getResourceName(), ref.getResourceType() == null ? null : ref.getResourceType().getCode(), null)).toList();
    }

    /** Only mutate a freshly constructed or copied response, never the persisted source snapshot. */
    public static void agentMessage(GroupChatContextResponse.Message message) {
        if (isSnapshotOnly(message.getForward()) || "FORWARD_SINGLE".equals(message.getKind()) || "FORWARD_MERGED".equals(message.getKind())) {
            message.setContent(projectPassive(message.getContent(), fromDisplay(message.getResourceList())));
            message.setResourceList(null);
            message.setAttachments(agentAttachments(message.getAttachments()));
            message.setAcknowledgements(List.of()); message.setCanAcknowledge(false);
            message.setTaskId(null); message.setTarget(null); message.setGroupCoordination(null);
        }
        if (message.getReplyTo() != null) agentReply(message.getReplyTo());
    }

    public static void agentReply(GroupChatContextResponse.ReplyReference reply) {
        if (isSnapshotOnly(reply.getForward())) {
            reply.setContent(projectPassive(reply.getContent(), fromDisplay(reply.getResourceList())));
            reply.setResourceList(null);
            reply.setAcknowledgements(List.of()); reply.setCanAcknowledge(false);
        }
    }

    public static List<GroupChatContextResponse.Attachment> agentAttachments(List<GroupChatContextResponse.Attachment> files) {
        if (files == null) return List.of();
        return files.stream().map(file -> {
            var safe = new GroupChatContextResponse.Attachment();
            safe.setFileName(file.getFileName()); safe.setMediaType(file.getMediaType()); safe.setSize(file.getSize());
            return safe;
        }).toList();
    }

    private static String text(JsonNode node, String key) {
        return node.path(key).isTextual() ? node.path(key).textValue() : null;
    }
}
