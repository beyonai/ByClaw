package com.iwhalecloud.byai.state.domain.sys.dto;

import lombok.Data;

/**
 * 安装包上传结果，字段可直接回填到 {@link AppVersionRequest} 的安装包部分。
 */
@Data
public class AppVersionUploadResult {

    private String fileName;

    private Long fileSize;

    /**
     * 对象存储地址；提交版本时原样写入 url
     */
    private String url;

    private String sha256;
}