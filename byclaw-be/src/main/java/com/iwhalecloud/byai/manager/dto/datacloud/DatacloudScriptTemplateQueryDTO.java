package com.iwhalecloud.byai.manager.dto.datacloud;

import lombok.Data;

/**
 * 脚本模板查询DTO
 * 
 * @author system
 * @date 2025-01-15
 */
@Data
public class DatacloudScriptTemplateQueryDTO {

    /**
     * 页码
     */
    private Integer pageNum = 1;

    /**
     * 页大小
     */
    private Integer pageSize = 10;

    /**
     * 模板名称（模糊查询）
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
     * 是否启用：0-禁用，1-启用
     */
    private Integer isActive;

    /**
     * 企业ID
     */
    private Long enterpriseId;

    /**
     * 创建人ID
     */
    private Long creatorId;

    /**
     * 是否包含模板内容
     */
    private Boolean includeContent = false;

}
