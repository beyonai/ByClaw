package com.iwhalecloud.byai.state.domain.groupchat.forward.attachment;

import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.TargetLease;
import java.time.Duration;

/** The operation store merges a single attachment patch under its existing short target transaction. */
public interface AttachmentCheckpointWriter {
    TargetLease checkpointAttachment(TargetLease lease, long expectedVersion, AttachmentCheckpointPatch patch);
    TargetLease renewTarget(TargetLease lease, Duration duration);
}
