package com.iwhalecloud.byai.state.common.util;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import org.springframework.web.multipart.MultipartFile;

/** 可重复打开的磁盘文件适配器；临时文件生命周期由调用方管理。 */
public final class PathMultipartFile implements MultipartFile {
    private final Path path;
    private final String name;
    private final String originalFilename;
    private final String contentType;
    private final long size;

    public PathMultipartFile(Path path, String name, String originalFilename, String contentType) throws IOException {
        this.path = path;
        this.name = name;
        this.originalFilename = originalFilename;
        this.contentType = contentType;
        this.size = Files.size(path);
    }

    @Override
    public String getName() { return name; }

    @Override
    public String getOriginalFilename() { return originalFilename; }

    @Override
    public String getContentType() { return contentType; }

    @Override
    public boolean isEmpty() { return size == 0; }

    @Override
    public long getSize() { return size; }

    @Override
    public byte[] getBytes() throws IOException { return Files.readAllBytes(path); }

    @Override
    public InputStream getInputStream() throws IOException { return Files.newInputStream(path); }

    @Override
    public void transferTo(File destination) throws IOException {
        Files.copy(path, destination.toPath(), StandardCopyOption.REPLACE_EXISTING);
    }
}
