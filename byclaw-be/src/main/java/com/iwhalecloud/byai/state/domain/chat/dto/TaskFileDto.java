package com.iwhalecloud.byai.state.domain.chat.dto;

import com.alibaba.fastjson.annotation.JSONField;
import lombok.Data;

import java.util.Date;
import java.util.List;

/**
 * 任务文件信息DTO
 */
@Data
public class TaskFileDto {

    /**
     * 文件ID
     */
    private Long fileId;

    /**
     * 文件名
     */
    private String fileName;

    /**
     * 文件大小（M）
     */
    private Integer fileSize;

    /**
     * 文件MD5
     */
    private String fileMd5;

    /**
     * 文件URL
     */
    private String fileUrl;

    /**
     * 标签列表
     */
    private List<String> tags;

    /**
     * 是否为临时文件
     */
    private Boolean isTemporary = false;

    /**
     * 上传日期
     */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date uploadedAt;
}