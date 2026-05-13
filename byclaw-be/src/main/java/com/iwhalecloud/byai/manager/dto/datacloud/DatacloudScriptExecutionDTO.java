package com.iwhalecloud.byai.manager.dto.datacloud;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import com.iwhalecloud.byai.common.annotation.Add;
import com.iwhalecloud.byai.common.annotation.Mod;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Data;

import java.util.Date;

/**
 * 脚本执行记录管理DTO
 * 
 * @author system
 * @date 2025-01-15
 */
@Data
public class DatacloudScriptExecutionDTO {

    /**
     * 执行记录主键ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = Mod.class, message = "{datacloud.script.execution.id.notnull}")
    private Long executionId;

    /**
     * 关联脚本ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.script.execution.script.id.notnull}")
    private Long scriptId;

    /**
     * 执行任务名称
     */
    @NotBlank(groups = {Add.class, Mod.class}, message = "{datacloud.script.execution.name.notblank}")
    @Size(groups = {Add.class, Mod.class}, max = 255, message = "{datacloud.script.execution.name.size}")
    private String executionName;

    /**
     * 执行状态：running、success、failed、cancelled
     */
    @NotBlank(groups = {Add.class, Mod.class}, message = "{datacloud.script.execution.status.notblank}")
    @Pattern(groups = {Add.class, Mod.class}, regexp = "^(running|success|failed|cancelled)$", 
             message = "{datacloud.script.execution.status.pattern}")
    private String executionStatus;

    /**
     * 执行参数（JSON格式）
     */
    private String executionParams;

    /**
     * 执行结果（JSON格式）
     */
    private String executionResult;

    /**
     * 错误信息
     */
    private String errorMessage;

    /**
     * 开始时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date startTime;

    /**
     * 结束时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date endTime;

    /**
     * 执行时长（毫秒）
     */
    private Long duration;

    /**
     * 企业ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.script.execution.enterprise.notnull}")
    private Long enterpriseId;

    /**
     * 创建人ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.script.execution.creator.notnull}")
    private Long creatorId;

    /**
     * 创建时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date createTime;

    // 扩展字段，用于显示

    /**
     * 脚本名称（用于显示）
     */
    private String scriptName;

    /**
     * 脚本类型（用于显示）
     */
    private String scriptType;

    /**
     * 创建人姓名（用于显示）
     */
    private String creatorName;

    /**
     * 执行参数对象（解析后的JSON对象）
     */
    private Object executionParamsObj;

    /**
     * 执行结果对象（解析后的JSON对象）
     */
    private Object executionResultObj;

    /**
     * 执行时长格式化显示（如：1分0秒）
     */
    private String durationText;

    /**
     * 执行状态中文显示
     */
    private String executionStatusText;
}
