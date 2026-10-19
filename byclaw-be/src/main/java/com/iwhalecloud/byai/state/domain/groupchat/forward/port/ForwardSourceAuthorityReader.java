package com.iwhalecloud.byai.state.domain.groupchat.forward.port;

import com.iwhalecloud.byai.state.domain.groupchat.forward.attachment.SourceAuthority.UploadSession;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.ForwardActor;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.ForwardBackend;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardSnapshotFactory.SourceMessage;

/** Owning-store reads only; implementations never perform remote file/QA I/O in a database transaction. */
public interface ForwardSourceAuthorityReader {
    SourceMessage readMessage(ForwardActor actor, long sourceSessionId, long selectedMessageId);
    UploadSession requireUploadSession(ForwardActor actor, long uploadSessionId);

    /** Backend comes from server source authority or its persisted locator, never a client request. */
    SourceMessage readMessage(ForwardActor actor, ForwardBackend backend, long sourceSessionId, long selectedMessageId);
    UploadSession requireUploadSession(ForwardActor actor, ForwardBackend backend, long uploadSessionId);
}
