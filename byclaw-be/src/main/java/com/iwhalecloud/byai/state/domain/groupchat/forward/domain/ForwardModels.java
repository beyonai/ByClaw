package com.iwhalecloud.byai.state.domain.groupchat.forward.domain;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import com.iwhalecloud.byai.state.domain.groupchat.forward.storage.ForwardUploadedFile;
import java.time.Instant;
import java.util.*;

/** Immutable values shared across forwarding orchestration and persistence ports. */
public final class ForwardModels {
    private ForwardModels() { }
    public enum ForwardMode { SINGLE, MERGED }
    public enum ForwardState { PENDING, COPYING, READY, SUCCEEDED, FAILED }
    /** Request outcome summarizes its independent target branches. */
    public enum ForwardOperationState { RUNNING, SUCCEEDED, PARTIAL_FAILED, FAILED }
    public enum SourceKind { UPLOADED_FILE, KNOWLEDGE_FILE, USER_WORKSPACE_FILE, UNRESOLVED_REFERENCE }
    public enum SpeakerType { USER, AGENT }
    public enum ForwardBackend { LEGACY, TENANT }
    public enum ForwardPhase { RESOLVE, COPY, COMMIT, DELIVERY }
    public record ForwardActor(long userId, long enterpriseId) {
        public ForwardActor { requireId(userId); requireId(enterpriseId); }
    }
    public record ForwardInput(String clientRequestId, ForwardMode mode, List<Long> messageIds, List<Long> targetSessionIds) {
        public ForwardInput {
            if (clientRequestId == null || !clientRequestId.matches("[A-Za-z0-9:_-]{1,64}") || mode == null) throw invalid();
            messageIds = normalizedIds(messageIds, 100); targetSessionIds = normalizedIds(targetSessionIds, 10);
        }
    }
    @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
    public record ForwardReference(String id, String resourceId, String resourceName, String resourceType,
            String resourceCode, String extData) {
        public ForwardReference(String id,String resourceId,String resourceName,String resourceType,String resourceCode) {
            this(id,resourceId,resourceName,resourceType,resourceCode,null);
        }
    }
    public record ForwardSpeaker(SpeakerType type, String id, String name) {
        public ForwardSpeaker { ForwardCodec.parseId(id); if (type == null || name == null || name.isBlank()) throw invalid(); }
    }
    /** Ordinary upload fields, shared with existing conversation and project-cloud attachment rendering. */
    public record ForwardAttachment(String fileId, String fileName, String filePath, String fileUrl,
            String cloudResourceId, String mediaType,
            @JsonSerialize(using = com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardCodec.LongNumberSerializer.class) long size) {
        public ForwardAttachment(String fileId,String fileName,String mediaType,long size,String ignoredHash,String fileUrl) {
            this(fileId,fileName,null,fileUrl,null,mediaType,size);
        }
    }
    public record ForwardItemTemplate(String sourceKey, @JsonSerialize(using = ToStringSerializer.class) long selectedMessageId,
            boolean selectedMergedCard, @JsonSerialize(using = ToStringSerializer.class) long sourceMessageId, int ordinal,
            String content, ForwardSpeaker speaker, String createdAt, List<ForwardReference> resourceList) {
        public ForwardItemTemplate { resourceList = List.copyOf(resourceList); }
    }
    public record ForwardItem(String itemId, @JsonSerialize(using = ToStringSerializer.class) long selectedMessageId,
            boolean selectedMergedCard, @JsonSerialize(using = ToStringSerializer.class) long sourceMessageId, int ordinal,
            String content, ForwardSpeaker speaker, String createdAt, List<ForwardReference> resourceList, List<ForwardAttachment> attachments) {
        public ForwardItem { resourceList = List.copyOf(resourceList); attachments = List.copyOf(attachments); }
    }
    public record SourceCandidate(String itemKey, long selectedMessageId, SourceKind kind, Map<String, Object> locatorCandidate, com.iwhalecloud.byai.state.domain.groupchat.forward.attachment.CandidateAddress address) {
        public SourceCandidate(String itemKey, long selectedMessageId, SourceKind kind, Map<String, Object> hints) { this(itemKey, selectedMessageId, kind, hints, null); }
        public SourceCandidate { locatorCandidate = immutableMap(locatorCandidate); }
    }
    public record FrozenSource(List<Long> selectedMessageIds, List<ForwardItemTemplate> items, List<SourceCandidate> candidates, int snapshotVersion) {
        public FrozenSource { selectedMessageIds = List.copyOf(selectedMessageIds); items = List.copyOf(items); candidates = List.copyOf(candidates); }
    }
    public record SourceIdentity(long enterpriseId, Long ownerId, String storageType, String scopeId, String path, String immutableVersion) { }
    public record SourceProof(String sourceId, SourceIdentity identity, @JsonSerialize(using = com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardCodec.LongNumberSerializer.class) long size, String sha256) { }
    public record TargetLease(long requestId, long targetId, ForwardActor actor, long sourceSessionId, long targetSessionId,
            String owner, long fencingVersion, @com.fasterxml.jackson.annotation.JsonFormat(shape = com.fasterxml.jackson.annotation.JsonFormat.Shape.STRING) Instant leaseUntil, ForwardState state) { }
    public record RequestLease(long requestId, ForwardActor actor, String owner, long fencingVersion, @com.fasterxml.jackson.annotation.JsonFormat(shape = com.fasterxml.jackson.annotation.JsonFormat.Shape.STRING) Instant leaseUntil) { }
    public record ForwardCheckpoint(List<SourceProof> sourceProofs, List<ForwardUploadedFile> copiedObjects, Map<String, String> attachmentMapping, int progress, List<com.iwhalecloud.byai.state.domain.groupchat.forward.attachment.ForwardCopyAttempt> attempts) {
        public ForwardCheckpoint(List<SourceProof> proofs, List<ForwardUploadedFile> objects, Map<String, String> mappings, int progress) { this(proofs, objects, mappings, progress, List.of()); }
        public ForwardCheckpoint { attempts = attempts == null ? List.of() : List.copyOf(attempts); sourceProofs = List.copyOf(sourceProofs); copiedObjects = List.copyOf(copiedObjects); attachmentMapping = Map.copyOf(attachmentMapping); }
    }
    public record ForwardTarget(@JsonSerialize(using = ToStringSerializer.class) long targetSessionId, ForwardState state,
            List<String> messageIds, String errorCode, boolean retryable) {
        public ForwardTarget { messageIds = List.copyOf(messageIds); }
    }
    public record ForwardOperation(@JsonSerialize(using = ToStringSerializer.class) long requestId, ForwardOperationState state, List<ForwardTarget> targets) {
        public ForwardOperation { targets = List.copyOf(targets); }
    }
    public record CommitResult(@JsonSerialize(using = ToStringSerializer.class) long targetId, @JsonSerialize(contentUsing = ToStringSerializer.class) List<Long> messageIds, ForwardState state, boolean pendingDelivery) {
        public CommitResult { messageIds = List.copyOf(messageIds); }
    }
    public record SafeDelivery(long targetId, List<Map<String, Object>> messages, List<Long> userRecipientIds, long enterpriseId) {
        public SafeDelivery { messages = messages.stream().map(ForwardModels::immutableMap).toList(); userRecipientIds = List.copyOf(userRecipientIds); }
    }
    public record CommittedTargetBinding(long targetId, long enterpriseId, long requestId) { }
    public record ForwardExecutionContext(ForwardActor actor, ForwardBackend backend, long requestId, Long targetId,
            TargetLease lease, ForwardPhase phase, Set<String> permissions) {
        public ForwardExecutionContext { permissions = Set.copyOf(permissions); }
    }
    static IllegalArgumentException invalid() { return new IllegalArgumentException("FORWARD_INVALID_REQUEST"); }
    static void requireId(long id) { if (id <= 0) throw invalid(); }
    static List<Long> normalizedIds(List<Long> values, int maximum) {
        if (values == null || values.isEmpty() || values.size() > maximum) throw invalid();
        values.forEach(id -> { if (id == null) throw invalid(); requireId(id); });
        return values.stream().distinct().sorted().toList();
    }
    /** Recursively copy server-only JSON locators so caller mutation cannot change frozen candidates. */
    public static Map<String, Object> immutableMap(Map<String, Object> source) {
        if (source == null) return Map.of();
        Map<String, Object> result = new LinkedHashMap<>();
        source.forEach((key, value) -> result.put(key, immutableJson(value)));
        return Collections.unmodifiableMap(result);
    }
    private static Object immutableJson(Object value) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> result = new LinkedHashMap<>();
            map.forEach((key, element) -> { if (!(key instanceof String)) throw invalid(); result.put((String) key, immutableJson(element)); });
            return Collections.unmodifiableMap(result);
        }
        if (value instanceof List<?> list) return Collections.unmodifiableList(list.stream().map(ForwardModels::immutableJson).toList());
        if (value == null || value instanceof String || value instanceof Number || value instanceof Boolean) return value;
        throw invalid();
    }
}
