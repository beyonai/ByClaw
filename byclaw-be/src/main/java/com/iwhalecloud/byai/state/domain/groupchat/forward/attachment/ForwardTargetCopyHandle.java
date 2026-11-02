package com.iwhalecloud.byai.state.domain.groupchat.forward.attachment;

import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.TargetLease;
import java.time.Duration;

/** Per-claim control state shared by file tasks and renewal, never a Spring singleton. */
public interface ForwardTargetCopyHandle extends AutoCloseable {
    TargetLease current();
    ForwardStreamCancellation cancellation();
    ForwardCopyBudget budget();
    com.iwhalecloud.byai.state.domain.groupchat.forward.storage.ForwardUploadedFile copyOnce(com.iwhalecloud.byai.state.domain.groupchat.forward.storage.ForwardUploadedFile allocated,
        java.util.function.Supplier<com.iwhalecloud.byai.state.domain.groupchat.forward.storage.ForwardUploadedFile> work);
    PreparedForwardSource requireSource(String itemId, String attachmentId, String sourceId);
    TargetLease checkpoint(AttachmentCheckpointPatch patch);
    TargetLease renew(Duration duration);
    TargetLease handoff();
    @Override void close();
}
