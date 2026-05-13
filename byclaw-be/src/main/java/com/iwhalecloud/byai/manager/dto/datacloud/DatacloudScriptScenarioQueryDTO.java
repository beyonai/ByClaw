package com.iwhalecloud.byai.manager.dto.datacloud;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import com.iwhalecloud.byai.common.vo.SortField;
import lombok.Data;

import java.util.List;

/**
 * 脚本场景查询DTO
 * 
 * @author system
 * @date 2025-01-15
 */
@Data
public class DatacloudScriptScenarioQueryDTO {

    /**
     * 场景名称（模糊查询）
     */
    private String scenarioName;

    /**
     * 场景编码（模糊查询）
     */
    private String scenarioCode;

    /**
     * 目标URL（模糊查询）
     */
    private String targetUrl;

    /**
     * 父场景ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long parentId;

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
     * 是否只查询顶级场景（parentId为null）
     */
    private Boolean onlyTopLevel;

    /**
     * 是否包含子场景数量统计
     */
    private Boolean includeChildCount;

    /**
     * 是否包含脚本数量统计
     */
    private Boolean includeScriptCount = true;

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
