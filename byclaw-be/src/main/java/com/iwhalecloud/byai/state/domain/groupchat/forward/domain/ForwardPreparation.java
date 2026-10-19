package com.iwhalecloud.byai.state.domain.groupchat.forward.domain;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.iwhalecloud.byai.state.domain.groupchat.forward.attachment.CandidateAddress;
import static com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import java.util.List;
/** Durable routing and source associations contain no transient locator metadata or stream handles. */
public final class ForwardPreparation {
    private ForwardPreparation() {
    }
    public record ForwardOperationLocator(long enterpriseId,long requestId,ForwardBackend backend) {
        public ForwardOperationLocator {
            if(enterpriseId<=0 || requestId<=0 || backend==null) throw new IllegalArgumentException("FORWARD_INVALID_REQUEST");
        }
    }
    public record OperationBinding(ForwardOperationLocator locator,ForwardActor actor,long sourceSessionId) {
    }
    public record PreparedCandidate(String candidateId,String itemKey,long selectedMessageId,SourceKind kind,CandidateAddress address) {
    }
    public record PreparedSlot(String candidateId,String targetId,String itemId,String attachmentId) {
    }
    public record CandidateResolution(String candidateId,String sourceId) {
    }
    public record FreezeCompletion(List<SourceProof> proofs,List<CandidateResolution> resolutions) {
        public FreezeCompletion {
            proofs=List.copyOf(proofs);
            resolutions=List.copyOf(resolutions);
        }
    }
    public record PreparedAttachment(String targetId,String itemId,String attachmentId,String sourceId,List<String> candidateIds,List<String> referenceKeys) {
        public PreparedAttachment {
            candidateIds=List.copyOf(candidateIds);
            referenceKeys=List.copyOf(referenceKeys);
        }
    }
    public record SourceManifest(int version,List<PreparedCandidate> candidates,List<PreparedSlot> slots,List<SourceProof> proofs,List<CandidateResolution> resolutions,List<PreparedAttachment> attachments) {
        public SourceManifest {
            candidates=List.copyOf(candidates);
            slots=List.copyOf(slots);
            proofs=List.copyOf(proofs);
            resolutions=List.copyOf(resolutions);
            attachments=List.copyOf(attachments);
        }
    }
    public record PreparedSnapshot(List<Long> selectedMessageIds,List<ForwardItemTemplate> items,int snapshotVersion) {
    }
    public record TargetWork(long targetId,long targetSessionId,ForwardState state,ObjectNode checkpoint,List<ForwardItem> items) {
    }
    public record ForwardWork(ForwardOperationLocator locator,ForwardActor actor,long sourceSessionId,PreparedSnapshot frozen,SourceManifest manifest,boolean sourcesFrozen,TargetWork target) {
    }
    public record WorkCandidate(ForwardOperationLocator locator,long targetId,boolean sourcesFrozen) {
    }
    public record WorkPage(List<WorkCandidate> candidates,String nextCursor,boolean hasMore) {
    }
    public record ClaimedWork(List<TargetLease> leases,String nextCursor,boolean hasMore) {
    }
    public record TargetIdentity(long targetId,long targetSessionId,ForwardState state) {
    }
    public record MaintenanceExecutionContext(OperationBinding binding,TargetIdentity target,ForwardPhase phase) {
    }
    public record RequestExecutionContext(OperationBinding binding,RequestLease lease,ForwardPhase phase) {
    }
    public record TargetExecutionContext(OperationBinding binding,TargetLease lease,ForwardPhase phase) {
    }
}
