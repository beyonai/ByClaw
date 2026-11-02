package com.iwhalecloud.byai.state.domain.groupchat.forward.attachment;

import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardSnapshotFactory.SourceMessage;

/** Transient authorized resolution. Only identity and frozen proof belong in durable manifests. */
public record ResolvedSource(SourceIdentity identity, String fileName, String mediaType, Long size,
        String adapterId, SourceMessage source, SourceCandidate candidate) { }
