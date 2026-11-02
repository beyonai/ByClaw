package com.iwhalecloud.byai.state.domain.groupchat.forward.domain;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.iwhalecloud.byai.state.domain.groupchat.forward.attachment.*;
import java.time.Instant;
import java.util.*;
import java.util.regex.Pattern;
import static com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;

/** Pure freezing of authorized, server-read messages. No candidate is a read authorization. */
public final class ForwardSnapshotFactory {
    private static final Set<String> KNOWN_TYPES = Set.of("AGENT", "DIG_EMPLOYEE", "CATALOGUE", "HUMAN_ASSISTANT", "KG_DOC", "KG_DOC_FOLDER", "KG_DOC_FILE", "KG_QA", "KG_QA_FOLDER", "KG_QA_FILE", "KG_TERM", "KG_TERM_FOLDER", "KG_TERM_FILE", "KG_DB", "DATA_SOURCE", "KG_DB_FOLDER", "KG_DB_FILE", "TOOLKIT", "MCP", "MCP_TOOL", "TOOL", "HUMAN", "VIEW", "OBJECT", "SKILL", "COMMON_FILE", "COMMON_FOLDER");
    private static final Pattern TOKEN = Pattern.compile("\\{\\{([^{}]+)}}");

    /** Raw fields are restricted to server-side source adapters, never HTTP request DTOs. */
    @JsonIgnoreProperties("sourceKey")
    public record SourceMessage(long id, int timelineOrdinal, String content, ForwardSpeaker speaker, String createdAt,
            List<Map<String, Object>> resourceList, Map<String, Object> relatedResources, Map<String, Object> metadata,
            List<SourceMessage> mergedItems, @JsonIgnore SourceAuthority authority) {
        public SourceMessage(long id, int ordinal, String content, ForwardSpeaker speaker, String createdAt, List<Map<String,Object>> refs, Map<String,Object> related, Map<String,Object> metadata, List<SourceMessage> merged) {
            this(id, ordinal, content, speaker, createdAt, refs, related, metadata, merged, null);
        }
        public SourceMessage {
            resourceList = resourceList == null ? List.of() : resourceList.stream().map(ForwardModels::immutableMap).toList();
            relatedResources = immutableMap(relatedResources); metadata = immutableMap(metadata);
            mergedItems = mergedItems == null ? List.of() : List.copyOf(mergedItems);
        }
    }
    public FrozenSource freeze(ForwardActor actor, long sourceId, List<SourceMessage> messages) {
        Objects.requireNonNull(actor); requireId(sourceId);
        if (messages == null || messages.isEmpty() || messages.size() > 100) throw invalid();
        var selected = messages.stream().sorted(Comparator.comparingInt(SourceMessage::timelineOrdinal).thenComparingLong(SourceMessage::id)).toList();
        var selectedIds = selected.stream().map(SourceMessage::id).toList();
        selectedIds.forEach(ForwardModels::requireId);
        if (new HashSet<>(selectedIds).size() != selectedIds.size()) throw invalid();
        List<ForwardItemTemplate> items = new ArrayList<>();
        List<SourceCandidate> candidates = new ArrayList<>();
        for (var message : selected) {
            boolean card = !message.mergedItems().isEmpty();
            for (var part : card ? message.mergedItems() : List.of(message)) {
                if (part != message && !part.mergedItems().isEmpty()) throw invalid();
                requireId(part.id());
                if (part.content() == null || part.speaker() == null) throw invalid();
                try { Instant.parse(part.createdAt()); } catch (Exception exception) { throw invalid(); }
                String sourceKey = message.id() + ":" + items.size();
                Map<String, ForwardReference> references = new LinkedHashMap<>();
                Map<String, Map<String, Object>> origins = new HashMap<>();
                for (var raw : part.resourceList()) {
                    String type = text(raw.get("resourceType")), resourceId = text(raw.get("resourceId"));
                    String id = text(raw.get("id"));
                    if (id == null && type != null && KNOWN_TYPES.contains(type) && resourceId != null && part.content().contains("{{" + type + "_" + resourceId + "}}")) id = type + "_" + resourceId;
                    if (id == null) continue;
                    String name = text(raw.get("resourceName"));
                    if (name == null) throw unresolved();
                    if (origins.containsKey(id)) {
                        if (!origins.get(id).equals(raw)) throw new IllegalArgumentException("FORWARD_REFERENCE_CONFLICT");
                        continue;
                    }
                    origins.put(id, raw);
                    references.put(id, new ForwardReference(id, resourceId, name, type, null));
                    if ("KG_DOC_FILE".equals(type) || "COMMON_FILE".equals(type)) {
                        if (resourceId == null) throw unresolved();
                        SourceKind kind = "KG_DOC_FILE".equals(type) ? SourceKind.KNOWLEDGE_FILE : SourceKind.USER_WORKSPACE_FILE;
                        candidates.add(new SourceCandidate(sourceKey, message.id(), kind, Map.of(), address(part, CandidateAddress.Origin.RESOURCE_REFERENCE, id)));
                    } else if (type == null || !KNOWN_TYPES.contains(type)) {
                        candidates.add(new SourceCandidate(sourceKey, message.id(), SourceKind.UNRESOLVED_REFERENCE,
                            Map.of(), address(part, CandidateAddress.Origin.RESOURCE_REFERENCE, id)));
                    }
                }
                var matcher = TOKEN.matcher(part.content());
                while (matcher.find()) {
                    String key = matcher.group(1);
                    if (KNOWN_TYPES.stream().anyMatch(type -> key.startsWith(type + "_")) && !references.containsKey(key)) throw unresolved();
                }
                collectFiles(part.relatedResources(), part, sourceKey, message.id(), CandidateAddress.Origin.RELATED_FILE, candidates);
                collectFiles(part.metadata(), part, sourceKey, message.id(), CandidateAddress.Origin.PUBLISHED_FILE, candidates);
                items.add(new ForwardItemTemplate(sourceKey, message.id(), card, part.id(), items.size(), part.content(), part.speaker(), part.createdAt(), new ArrayList<>(references.values())));
                if (items.size() > 100) throw new IllegalArgumentException("FORWARD_TOO_MANY_ITEMS");
            }
        }
        // Limits apply to serialized UTF-8 bytes, including escaped content and public names.
        if (ForwardCodec.jsonBytes(items).length > 1048576) throw new IllegalArgumentException("FORWARD_SNAPSHOT_TOO_LARGE");
        return new FrozenSource(selectedIds, items, candidates, 1);
    }
    private void collectFiles(Map<String, Object> container, SourceMessage part, String key, long selectedId, CandidateAddress.Origin origin, List<SourceCandidate> candidates) {
        if (!(container.get("files") instanceof List<?> files)) return;
        for (int index = 0; index < files.size(); index++) {
            Object file = files.get(index);
            if (!(file instanceof Map<?, ?> map)) throw unresolved();
            Map<String, Object> locator = new LinkedHashMap<>();
            map.forEach((field, value) -> { if (!(field instanceof String)) throw unresolved(); locator.put((String) field, value); });
            candidates.add(new SourceCandidate(key, selectedId, SourceKind.UPLOADED_FILE, Map.of(), address(part, origin, Integer.toString(index))));
        }
    }
    private CandidateAddress address(SourceMessage part, CandidateAddress.Origin origin, String key) {
        return new CandidateAddress(part.authority() == null ? null : part.authority().currentItemId(), origin, key);
    }
    /** Literal replacement keeps dollars and backslashes in names as data. */
    public String projectText(ForwardItemTemplate item) {
        Map<String, String> names = new HashMap<>();
        item.resourceList().forEach(reference -> names.put(reference.id(), reference.resourceName()));
        var matcher = TOKEN.matcher(item.content());
        return matcher.replaceAll(match -> java.util.regex.Matcher.quoteReplacement(names.getOrDefault(match.group(1), match.group())));
    }
    private static String text(Object value) { return value instanceof String text && !text.isBlank() ? text : null; }
    private static IllegalArgumentException unresolved() { return new IllegalArgumentException("FORWARD_RESOURCE_UNRESOLVABLE"); }
}
