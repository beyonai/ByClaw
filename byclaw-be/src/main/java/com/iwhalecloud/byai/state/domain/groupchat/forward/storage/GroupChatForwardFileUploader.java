package com.iwhalecloud.byai.state.domain.groupchat.forward.storage;

import java.io.InputStream;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.attachment.ForwardSourceRead;

/** Forwarding delegates persistence to ordinary conversation or project-cloud uploads. */
public interface GroupChatForwardFileUploader {
    ForwardUploadedFile upload(ForwardActor actor, ForwardBackend backend, boolean knowledge,
        ForwardUploadedFile reservation, InputStream source, SourceProof proof, String contentType, long maxBytes);
}
