package com.iwhalecloud.byai.state.domain.chat.dto;

import java.nio.file.Path;
import org.springframework.web.multipart.MultipartFile;
import java.io.*;

/**
 * 自定义 MultipartFile 包装类，支持修改文件名
 */
public class CustomFilenameMultipartFile implements MultipartFile {

    // 原始 MultipartFile
    private final MultipartFile originalFile;
    // 新文件名（含后缀）
    private final String newFilename;

    // 构造器：传入原始文件和新文件名
    public CustomFilenameMultipartFile(MultipartFile originalFile, String newFilename) {
        this.originalFile = originalFile;
        this.newFilename = newFilename;
    }

    // 核心：重写文件名方法，返回新文件名
    @Override
    public String getOriginalFilename() {
        return newFilename;
    }

    // 以下方法直接委托给原始文件实现（无需修改）
    @Override
    public String getName() {
        return originalFile.getName();
    }

    @Override
    public String getContentType() {
        return originalFile.getContentType();
    }

    @Override
    public boolean isEmpty() {
        return originalFile.isEmpty();
    }

    @Override
    public long getSize() {
        return originalFile.getSize();
    }

    @Override
    public byte[] getBytes() throws IOException {
        return originalFile.getBytes();
    }

    @Override
    public InputStream getInputStream() throws IOException {
        return originalFile.getInputStream();
    }

    @Override
    public void transferTo(File dest) throws IOException, IllegalStateException {
        originalFile.transferTo(dest);
    }

    // Spring 5.1+ 新增方法，需实现（委托给原始文件）
    @Override
    public void transferTo(Path dest) throws IOException, IllegalStateException {
        originalFile.transferTo(dest);
    }
}