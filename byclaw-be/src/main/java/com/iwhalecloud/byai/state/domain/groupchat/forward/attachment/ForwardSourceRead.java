package com.iwhalecloud.byai.state.domain.groupchat.forward.attachment;

import java.io.IOException;
import java.io.InputStream;
import java.util.Objects;
import com.iwhalecloud.byai.common.storage.model.FileMetadata;

/** Owns the authorized source stream; closing this handle closes the underlying transport. */
public record ForwardSourceRead(InputStream stream, FileMetadata metadata) implements AutoCloseable {
    public ForwardSourceRead {
        Objects.requireNonNull(stream);
        Objects.requireNonNull(metadata);
    }
    @Override public void close() throws IOException { stream.close(); }
}
