package com.iwhalecloud.byai.state.domain.groupchat.forward.attachment;

import com.iwhalecloud.byai.state.domain.groupchat.forward.storage.ForwardUploadedFile;

/** Track upload attempts for lease handoff and retries; zero-byte files are valid verified copies. */
public record ForwardCopyAttempt(String sourceId, ForwardUploadedFile object, State state) {
    public enum State { RESERVED, VERIFIED, SUPERSEDED }
}
