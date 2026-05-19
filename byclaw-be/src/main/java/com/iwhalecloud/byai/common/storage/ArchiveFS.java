package com.iwhalecloud.byai.common.storage;

import java.io.InputStream;
import java.util.List;

import org.springframework.web.multipart.MultipartFile;

import com.iwhalecloud.byai.common.storage.model.FileMetadata;

public interface ArchiveFS {

    int DEFAULT_LIST_DEPTH = 3;

    /**
     * 用户归档文件系统：初始化底层存储。
     */
    void init();

    /**
     * 用户归档文件系统：读。
     */
    InputStream read(String filePath);

    /**
     * 用户归档文件系统：删除文件或目录。
     */
    Boolean delete(String filePath);

    /**
     * 用户归档文件系统：list。
     */
    List<String> list(String filePath, Integer maxDepth);

    /**
     * 用户归档文件系统：写。
     */
    FileMetadata write(MultipartFile multipartFile, String filePath);

    /**
     * 用户归档文件系统：流式写。
     */
    FileMetadata write(InputStream inputStream, long size, String contentType, String filePath);
}
