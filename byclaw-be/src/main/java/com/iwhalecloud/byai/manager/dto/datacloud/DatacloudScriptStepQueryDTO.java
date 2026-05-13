package com.iwhalecloud.byai.manager.dto.datacloud;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import com.iwhalecloud.byai.common.vo.SortField;
import lombok.Data;

import java.util.List;

/**
 * 脚本步骤查询DTO
 * 
 * @author system
 * @date 2025-01-15
 */
@Data
public class DatacloudScriptStepQueryDTO {

    /**
     * 步骤名称（模糊查询）
     */
    private String stepName;

    /**
     * 关联的模板ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long templateId;

    /**
     * 关联脚本ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long scriptId;

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
     * 是否按步骤顺序排序
     */
    private Boolean orderByStepOrder;

    /**
     * 是否包含JSON对象解析
     */
    private Boolean includeJsonObjects;

    /**
     * 分页参数 - 页码
     */
    private Integer pageNum = 1;

    /**
     * 分页参数 - 每页大小
     */
    private Integer pageSize = 10;

    /**
     * 排序字段列表
     */
    private List<SortField> sortFields;
}
