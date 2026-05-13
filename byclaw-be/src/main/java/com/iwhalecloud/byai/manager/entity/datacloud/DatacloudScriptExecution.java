package com.iwhalecloud.byai.manager.entity.datacloud;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
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

import java.io.Serializable;
import java.util.Date;

/**
 * 脚本执行记录表实体类
 * 用于记录脚本的执行历史和结果
 * 
 * @author system
 * @date 2025-01-15
 */
@Data
@TableName("datacloud_script_execution")
public class DatacloudScriptExecution implements Serializable {

    private static final long serialVersionUID = 1L;

    /**
     * 执行记录主键ID
     */
    @TableId(type = IdType.INPUT)
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
}
