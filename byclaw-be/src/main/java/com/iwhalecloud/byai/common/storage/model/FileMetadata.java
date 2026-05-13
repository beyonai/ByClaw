package com.iwhalecloud.byai.common.storage.model;

import lombok.Getter;
import lombok.Setter;

/**
 * 文件元信息数据模型
 *
 * @author hux
 * @date 2025-08-15
 */
@Getter
@Setter
public class FileMetadata {

    private String fileTag;

    private String fileName;

    private String fileUrl;

    private Long fileSize;

    private String fileType;

    private String contentType;

    private String fileMd5;

    private String bucketName;

    private String storageType;
}
