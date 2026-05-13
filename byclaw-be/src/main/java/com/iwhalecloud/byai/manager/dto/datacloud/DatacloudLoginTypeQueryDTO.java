package com.iwhalecloud.byai.manager.dto.datacloud;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import com.iwhalecloud.byai.common.vo.SortField;
import lombok.Data;

import java.util.Date;
import java.util.List;

/**
 * 登录类型查询DTO
 * 
 * @author system
 * @date 2025-01-15
 */
@Data
public class DatacloudLoginTypeQueryDTO {

    /**
     * 登录类型名称（模糊查询）
     */
    private String loginTypeName;

    /**
     * 登录类型编码（模糊查询）
     */
    private String loginTypeCode;

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
     * 创建时间开始
     */
    private Date createTimeStart;

    /**
     * 创建时间结束
     */
    private Date createTimeEnd;

    /**
     * 是否包含关联脚本数量统计
     */
    private Boolean includeScriptCount;

    /**
     * 是否只查询启用的登录类型
     */
    private Boolean onlyActive;

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
