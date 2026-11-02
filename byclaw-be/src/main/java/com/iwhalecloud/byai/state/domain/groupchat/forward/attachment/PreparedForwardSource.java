package com.iwhalecloud.byai.state.domain.groupchat.forward.attachment;

import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.SourceProof;
import java.util.List;
import java.util.Objects;

/** Explicit prepared item/source association; keys are opaque and no stream is retained. */
public record PreparedForwardSource(String itemId, String attachmentId, SourceProof proof,
        ResolvedSource resolved, List<String> referenceKeys, List<CandidateAddress> candidates) {
    public PreparedForwardSource {
        Objects.requireNonNull(itemId); Objects.requireNonNull(attachmentId);
        Objects.requireNonNull(proof); Objects.requireNonNull(resolved);
        referenceKeys = List.copyOf(referenceKeys); candidates = List.copyOf(candidates);
        if (proof.size() < 0 || proof.sha256() == null || !proof.sha256().matches("[a-f0-9]{64}") || !proof.identity().equals(resolved.identity())) throw new IllegalArgumentException("FORWARD_SOURCE_CHANGED");
    }
}
