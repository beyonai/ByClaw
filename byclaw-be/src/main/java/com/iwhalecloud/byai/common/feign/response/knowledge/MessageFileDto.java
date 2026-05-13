package com.iwhalecloud.byai.common.feign.response.knowledge;

import lombok.Data;

/**
 * @author zht
 * @version 1.0
 * @date 2025/5/22
 */
@Data
public class MessageFileDto {

    /**
     * 文件id
     */
    private Long fileId;

    /**
     * 文件名称
     */
    private String fileName;

    /**
     * 文件地址
     */
    private String fileUrl;

    /**
     * 文件大小
     */
    private Integer fileSize;

    /**
     * 文件类型
     */
    private String fileType;
}
