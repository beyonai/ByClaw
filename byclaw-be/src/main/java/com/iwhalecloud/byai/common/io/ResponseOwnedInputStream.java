package com.iwhalecloud.byai.common.io;

import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Objects;

/** Transfers HTTP response ownership to the consumer without reading the body eagerly. */
public final class ResponseOwnedInputStream extends FilterInputStream {
    private final AutoCloseable response;
    private boolean closed;

    public ResponseOwnedInputStream(InputStream delegate, AutoCloseable response) {
        super(Objects.requireNonNull(delegate));
        this.response = Objects.requireNonNull(response);
    }

    @Override
    public int read() throws IOException {
        try {
            return in.read();
        } catch (IOException | RuntimeException failure) {
            closeAfterFailure(failure);
            throw failure;
        }
    }

    @Override
    public int read(byte[] bytes, int offset, int length) throws IOException {
        try {
            return in.read(bytes, offset, length);
        } catch (IOException | RuntimeException failure) {
            closeAfterFailure(failure);
            throw failure;
        }
    }

    @Override
    public long skip(long count) throws IOException {
        try {
            return in.skip(count);
        } catch (IOException | RuntimeException failure) {
            closeAfterFailure(failure);
            throw failure;
        }
    }

    private void closeAfterFailure(Exception failure) {
        try {
            close();
        } catch (IOException closeFailure) {
            failure.addSuppressed(closeFailure);
        }
    }

    @Override
    public synchronized void close() throws IOException {
        if (closed) {
            return;
        }
        closed = true;
        Exception failure = null;
        try {
            in.close();
        } catch (Exception e) {
            failure = e;
        }
        try {
            response.close();
        } catch (Exception e) {
            if (failure == null) {
                failure = e;
            } else if (failure != e) {
                failure.addSuppressed(e);
            }
        }
        if (failure != null) {
            throw failure instanceof IOException io ? io : new IOException("Closing HTTP response failed", failure);
        }
    }
}
