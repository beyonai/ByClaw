package com.iwhalecloud.byai.state.domain.chat.model;

import lombok.Data;

/**
 * @author zht
 * @version 1.0
 * @date 2025/5/22
 */
@Data
public class MessageFileDto {

    /**
     * 知识库id
     */
    private String datasetId;

    /**
     * 文件来源类型 (knowledgeBase)
     */
    private String sourceType;

    /**
     * 文件用途 (content)
     */
    private String useType;

    /**
     * 文件id
     */
    private String fileId;

    /**
     * 文件名称
     */
    private String fileName;

    /**
     * 文件地址
     */
    private String fileUrl;

    /**
     * 文件路径
     */
    private String filePath;

    /**
     * 文件大小
     */
    private Integer fileSize;

    /**
     * 文件类型
     */
    private String fileType;
    /**
     * 文件ip
     */
    private String fileIp;
}
