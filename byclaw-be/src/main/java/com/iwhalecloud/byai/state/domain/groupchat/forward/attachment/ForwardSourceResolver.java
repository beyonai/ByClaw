package com.iwhalecloud.byai.state.domain.groupchat.forward.attachment;

import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardSnapshotFactory.SourceMessage;

/** Resolves only authoritative single files. A folder disposition is handled before this boundary. */
public interface ForwardSourceResolver {
    ResolvedSource resolve(ForwardActor actor, SourceMessage source, SourceCandidate candidate);
    ForwardSourceRead open(ForwardActor actor, ResolvedSource source);
}
