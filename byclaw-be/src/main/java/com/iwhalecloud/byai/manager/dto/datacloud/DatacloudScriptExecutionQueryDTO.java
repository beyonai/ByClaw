package com.iwhalecloud.byai.manager.dto.datacloud;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import com.iwhalecloud.byai.common.vo.SortField;
import lombok.Data;

import java.util.Date;
import java.util.List;

/**
 * 脚本执行记录查询DTO
 * 
 * @author system
 * @date 2025-01-15
 */
@Data
public class DatacloudScriptExecutionQueryDTO {

    /**
     * 执行任务名称（模糊查询）
     */
    private String executionName;

    /**
     * 执行状态：running、success、failed、cancelled
     */
    private String executionStatus;

    /**
     * 关联脚本ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long scriptId;

    /**
     * 脚本名称（模糊查询）
     */
    private String scriptName;

    /**
     * 脚本类型
     */
    private String scriptType;

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
     * 开始时间开始
     */
    private Date startTimeStart;

    /**
     * 开始时间结束
     */
    private Date startTimeEnd;

    /**
     * 结束时间开始
     */
    private Date endTimeStart;

    /**
     * 结束时间结束
     */
    private Date endTimeEnd;

    /**
     * 创建时间开始
     */
    private Date createTimeStart;

    /**
     * 创建时间结束
     */
    private Date createTimeEnd;

    /**
     * 最小执行时长（毫秒）
     */
    private Long minDuration;

    /**
     * 最大执行时长（毫秒）
     */
    private Long maxDuration;

    /**
     * 是否有错误信息
     */
    private Boolean hasError;

    /**
     * 执行状态列表（用于多选查询）
     */
    private List<String> executionStatuses;

    /**
     * 脚本类型列表（用于多选查询）
     */
    private List<String> scriptTypes;

    /**
     * 是否只查询我的执行记录
     */
    private Boolean onlyMyExecutions;

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
