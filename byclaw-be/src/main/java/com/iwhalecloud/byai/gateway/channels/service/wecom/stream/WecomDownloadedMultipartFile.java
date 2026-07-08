package com.iwhalecloud.byai.gateway.channels.service.wecom.stream;

import org.springframework.web.multipart.MultipartFile;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;

/**
 * Wraps decrypted WeCom media bytes as a {@link MultipartFile} for
 * {@code AssistantChatApplicationService.uploadFiles} (mirror of
 * {@code DingtalkDownloadedMultipartFile}).
 */
public class WecomDownloadedMultipartFile implements MultipartFile {

    private final String fieldName;
    private final String originalFilename;
    private final String contentType;
    private final byte[] bytes;

    public WecomDownloadedMultipartFile(String fieldName, String originalFilename, String contentType, byte[] bytes) {
        this.fieldName = fieldName;
        this.originalFilename = originalFilename;
        this.contentType = contentType;
        this.bytes = bytes == null ? new byte[0] : bytes;
    }

    @Override
    public String getName() {
        return fieldName;
    }

    @Override
    public String getOriginalFilename() {
        return originalFilename;
    }

    @Override
    public String getContentType() {
        return contentType;
    }

    @Override
    public boolean isEmpty() {
        return bytes.length == 0;
    }

    @Override
    public long getSize() {
        return bytes.length;
    }

    @Override
    public byte[] getBytes() {
        return bytes;
    }

    @Override
    public InputStream getInputStream() {
        return new ByteArrayInputStream(bytes);
    }

    @Override
    public void transferTo(File dest) throws IOException {
        Files.write(dest.toPath(), bytes);
    }
}
