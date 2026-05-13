package com.iwhalecloud.byai.manager.dto.datacloud;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Data;

import java.util.Date;

/**
 * 脚本模板DTO
 * 
 * @author system
 * @date 2025-01-15
 */
@Data
public class DatacloudScriptTemplateDTO {

    /**
     * 模板主键ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long templateId;

    /**
     * 模板名称
     */
    private String templateName;

    /**
     * 脚本组件类型
     */
    private String templateType;

    /**
     * 脚本框架类型
     */
    private String framework;

    /**
     * Python脚本模板内容
     */
    private String pyTemplateContent;

    /**
     * NodeJS脚本模板内容
     */
    private String nodeTemplateContent;

    /**
     * 使用到的参数变量定义（JSON格式）
     */
    private String metaInfos;

    /**
     * 模板描述
     */
    private String templateDescription;

    /**
     * 是否启用：0-禁用，1-启用
     */
    private Integer isActive;

    /**
     * 企业ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long enterpriseId;

    /**
     * 创建人ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long creatorId;

    /**
     * 创建时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date createTime;

    /**
     * 更新者ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long updateBy;

    /**
     * 更新时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date updateTime;
}
