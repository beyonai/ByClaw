package com.iwhalecloud.byai.manager.dto.datacloud;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import com.iwhalecloud.byai.common.vo.SortField;
import lombok.Data;

import java.util.Date;
import java.util.List;

/**
 * 脚本分类查询DTO
 * 
 * @author system
 * @date 2025-01-15
 */
@Data
public class DatacloudScriptCategoryQueryDTO {

    /**
     * 分类名称（模糊查询）
     */
    private String categoryName;

    /**
     * 分类编码（模糊查询）
     */
    private String categoryCode;

    /**
     * 父分类ID
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
     * 创建时间开始
     */
    private Date createTimeStart;

    /**
     * 创建时间结束
     */
    private Date createTimeEnd;

    /**
     * 是否只查询顶级分类（parentId为null）
     */
    private Boolean onlyTopLevel;

    /**
     * 是否包含子分类数量统计
     */
    private Boolean includeChildCount;

    /**
     * 是否包含脚本数量统计
     */
    private Boolean includeScriptCount;

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
