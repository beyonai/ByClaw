package com.iwhalecloud.byai.common.io;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.io.InputStream;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class ResponseOwnedInputStreamTest {
    @Test
    void openingDoesNotPreReadWholeBody() throws Exception {
        AtomicInteger reads = new AtomicInteger();
        AtomicInteger closes = new AtomicInteger();
        InputStream body = new InputStream() {
            public int read() { reads.incrementAndGet(); return 1; }
            public void close() { closes.incrementAndGet(); }
            public byte[] readAllBytes() { throw new AssertionError("whole body read"); }
        };
        AtomicInteger responses = new AtomicInteger();
        InputStream stream = new ResponseOwnedInputStream(body, responses::incrementAndGet);
        assertThat(reads).hasValue(0);
        assertThat(stream.readNBytes(4096)).hasSize(4096);
        assertThat(reads).hasValue(4096);
        stream.close();
        stream.close();
        assertThat(closes).hasValue(1);
        assertThat(responses).hasValue(1);
    }

    @Test
    void readFailureAndEarlyCloseReleaseResponse() {
        AtomicInteger closes = new AtomicInteger();
        InputStream body = new InputStream() {
            public int read() throws IOException { throw new IOException("read failed"); }
            public void close() throws IOException { closes.incrementAndGet(); throw new IOException("close failed"); }
        };
        AtomicInteger responses = new AtomicInteger();
        InputStream stream = new ResponseOwnedInputStream(body, responses::incrementAndGet);
        assertThatThrownBy(stream::read).isInstanceOf(IOException.class).hasMessage("read failed")
            .satisfies(error -> assertThat(error.getSuppressed()).hasSize(1));
        assertThat(closes).hasValue(1);
        assertThat(responses).hasValue(1);
    }

    @Test
    void bulkReadFailureClosesResponseEvenWhenDelegateCloseFails() {
        AtomicInteger responses = new AtomicInteger();
        InputStream stream = new ResponseOwnedInputStream(new InputStream() {
            public int read() throws IOException { throw new IOException("broken"); }
        }, () -> { responses.incrementAndGet(); throw new IllegalStateException("response close"); });
        assertThatThrownBy(() -> stream.read(new byte[4096])).isInstanceOf(IOException.class).hasMessage("broken");
        assertThat(responses).hasValue(1);
    }
}
