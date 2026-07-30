package com.iwhalecloud.byai.common.storage;

import java.io.InputStream;
import java.util.List;

import org.springframework.web.multipart.MultipartFile;

import com.iwhalecloud.byai.common.storage.model.FileMetadata;

/**
 * 知识库文档专用 ResourceFS。
 * 与公共 ResourceFS 分离，避免知识库原文和 Markdown 产物进入公共资源桶。
 */
public interface KnowledgeResourceFS {

    int DEFAULT_LIST_DEPTH = 3;

    void init();

    InputStream read(String filePath);

    Boolean delete(String filePath);

    List<String> list(String filePath, Integer maxDepth);

    FileMetadata write(MultipartFile multipartFile, String filePath);

    FileMetadata write(InputStream inputStream, long size, String contentType, String filePath);
}
