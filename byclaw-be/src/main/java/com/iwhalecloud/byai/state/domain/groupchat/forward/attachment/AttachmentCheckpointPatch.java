package com.iwhalecloud.byai.state.domain.groupchat.forward.attachment;

import com.iwhalecloud.byai.state.domain.groupchat.forward.storage.ForwardUploadedFile;
import java.util.Objects;

/** A single attempt mutation; the owning store derives aliases and progress from prepared associations. */
public record AttachmentCheckpointPatch(Phase phase, String sourceId, ForwardUploadedFile object) {
    public enum Phase { RESERVE, VERIFY }
    public AttachmentCheckpointPatch {
        Objects.requireNonNull(phase); Objects.requireNonNull(object);
        if (sourceId == null || sourceId.isBlank()) throw new IllegalArgumentException("FORWARD_RESOURCE_UNRESOLVABLE");
    }
}
