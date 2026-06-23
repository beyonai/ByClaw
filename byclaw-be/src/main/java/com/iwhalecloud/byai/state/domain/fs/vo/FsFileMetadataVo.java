package com.iwhalecloud.byai.state.domain.fs.vo;

import lombok.Getter;
import lombok.Setter;

/**
 * @author qin.guoquan
 * @date 2026-06-10 17:38:38
 */
@Getter
@Setter
public class FsFileMetadataVo {

    /**
     * 文件空间类型：USER 或 RESOURCE。
     */
    private String spaceType;

    /**
     * 资源 ID；USER 空间为空。
     */
    private Long resourceId;

    /**
     * 文件完整路径。
     */
    private String path;

    /**
     * 文件名，优先使用存储层返回值。
     */
    private String fileName;

    /**
     * 文件大小，单位字节。
     */
    private Long fileSize;

    /**
     * MIME 类型。
     */
    private String contentType;

    /**
     * 文件校验值，当前映射存储层 MD5。
     */
    private String checksum;

    /**
     * 底层对象存储桶名称。
     */
    private String bucketName;

    /**
     * 底层存储类型。
     */
    private String storageType;
}
