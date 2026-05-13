package com.iwhalecloud.byai.gateway.sandbox.workspace;

import org.junit.jupiter.api.Test;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import static org.assertj.core.api.Assertions.*;

class InputStreamMultipartFileTest {

    @Test
    void getInputStream_returnsProvidedStream() throws IOException {
        InputStream stream = new ByteArrayInputStream("hello".getBytes());
        var file = new InputStreamMultipartFile("test.txt", stream, 5L, "text/plain");
        assertThat(file.getInputStream()).isSameAs(stream);
    }

    @Test
    void getSize_returnsProvidedSize() {
        var file = new InputStreamMultipartFile("f.txt", InputStream.nullInputStream(), 42L, "text/plain");
        assertThat(file.getSize()).isEqualTo(42L);
    }

    @Test
    void getContentType_returnsProvidedContentType() {
        var file = new InputStreamMultipartFile("f.txt", InputStream.nullInputStream(), 0L, "application/json");
        assertThat(file.getContentType()).isEqualTo("application/json");
    }

    @Test
    void getName_returnsFileName() {
        var file = new InputStreamMultipartFile("report.pdf", InputStream.nullInputStream(), 0L, "application/pdf");
        assertThat(file.getName()).isEqualTo("report.pdf");
        assertThat(file.getOriginalFilename()).isEqualTo("report.pdf");
    }

    @Test
    void isEmpty_trueWhenSizeIsZero() {
        var file = new InputStreamMultipartFile("empty.txt", InputStream.nullInputStream(), 0L, "text/plain");
        assertThat(file.isEmpty()).isTrue();
    }

    @Test
    void isEmpty_falseWhenSizeIsPositive() {
        var file = new InputStreamMultipartFile("data.bin", InputStream.nullInputStream(), 1L, "application/octet-stream");
        assertThat(file.isEmpty()).isFalse();
    }

    @Test
    void transferTo_throwsUnsupportedOperationException() {
        var file = new InputStreamMultipartFile("f.txt", InputStream.nullInputStream(), 0L, "text/plain");
        assertThatThrownBy(() -> file.transferTo(new java.io.File("/tmp/x")))
            .isInstanceOf(UnsupportedOperationException.class);
    }
}
