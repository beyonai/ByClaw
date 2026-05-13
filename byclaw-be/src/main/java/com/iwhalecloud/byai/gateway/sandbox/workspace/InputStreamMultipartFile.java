package com.iwhalecloud.byai.gateway.sandbox.workspace;

import org.springframework.web.multipart.MultipartFile;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;

/**
 * Wraps an InputStream as MultipartFile for use with file ingress upload.
 * No temporary files are written to disk — pure in-memory adapter.
 */
class InputStreamMultipartFile implements MultipartFile {

    private final String name;
    private final InputStream inputStream;
    private final long size;
    private final String contentType;

    InputStreamMultipartFile(String name, InputStream inputStream, long size, String contentType) {
        this.name = name;
        this.inputStream = inputStream;
        this.size = size;
        this.contentType = contentType;
    }

    @Override public String getName() { return name; }
    @Override public String getOriginalFilename() { return name; }
    @Override public String getContentType() { return contentType; }
    @Override public boolean isEmpty() { return size == 0; }
    @Override public long getSize() { return size; }
    @Override public byte[] getBytes() throws IOException { return inputStream.readAllBytes(); }
    @Override public InputStream getInputStream() { return inputStream; }

    @Override
    public void transferTo(File dest) {
        throw new UnsupportedOperationException("transferTo is not supported");
    }
}
