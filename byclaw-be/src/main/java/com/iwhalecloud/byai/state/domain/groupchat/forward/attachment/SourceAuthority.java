package com.iwhalecloud.byai.state.domain.groupchat.forward.attachment;

import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import java.util.*;

/** Transient owning-store evidence; never accepted from a forwarding HTTP body or serialized in a manifest. */
public record SourceAuthority(ForwardActor actor, ForwardBackend backend, long sourceSessionId,
        long selectedMessageId, Long projectId, String currentItemId, String scene, String kind,
        List<Map<String,Object>> publicationFiles) {
    public SourceAuthority {
        Objects.requireNonNull(actor); Objects.requireNonNull(backend);
        publicationFiles = publicationFiles.stream().map(Map::copyOf).toList();
    }
    /** The reader has checked the actor and tenant of the actual owning upload session. */
    public record UploadSession(ForwardActor actor, ForwardBackend backend, long sessionId, long enterpriseId) { }
}
