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
 * 脚本步骤历史记录表实体类
 * 用于记录脚本步骤的变更历史
 * 
 * @author system
 * @date 2025-01-15
 */
@Data
@TableName("datacloud_script_step_history")
public class DatacloudScriptStepHistory implements Serializable {

    private static final long serialVersionUID = 1L;

    /**
     * 步骤历史记录主键ID
     */
    @TableId(type = IdType.INPUT)
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = Mod.class, message = "{datacloud.script.step.history.id.notnull}")
    private Long stepHistoryId;

    /**
     * 关联步骤ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.script.step.history.step.id.notnull}")
    private Long stepId;

    /**
     * 关联脚本ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.script.step.history.script.id.notnull}")
    private Long scriptId;

    /**
     * 步骤名称
     */
    @NotBlank(groups = {Add.class, Mod.class}, message = "{datacloud.script.step.history.name.notblank}")
    @Size(groups = {Add.class, Mod.class}, max = 255, message = "{datacloud.script.step.history.name.size}")
    private String stepName;

    /**
     * 步骤类型
     */
    @NotBlank(groups = {Add.class, Mod.class}, message = "{datacloud.script.step.history.type.notblank}")
    @Size(groups = {Add.class, Mod.class}, max = 50, message = "{datacloud.script.step.history.type.size}")
    private String stepType;

    /**
     * 步骤内容（JSON格式）
     */
    @NotBlank(groups = {Add.class, Mod.class}, message = "{datacloud.script.step.history.content.notblank}")
    private String stepContent;

    /**
     * 步骤顺序
     */
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.script.step.history.order.notnull}")
    private Integer stepOrder;

    /**
     * 步骤描述
     */
    private String stepDescription;

    /**
     * 选择器信息（JSON格式）
     */
    private String selectorInfo;

    /**
     * 预期结果
     */
    private String expectedResult;

    /**
     * 步骤输入参数Schema（JSON Schema格式）
     */
    private String inputSchema;

    /**
     * 步骤输出参数Schema（JSON Schema格式）
     */
    private String outputSchema;

    /**
     * 参数映射关系（JSON格式）
     */
    private String paramMapping;

    /**
     * 变更描述
     */
    private String changeDescription;

    /**
     * 变更类型：create、update、delete、order_change
     */
    @NotBlank(groups = {Add.class, Mod.class}, message = "{datacloud.script.step.history.change.type.notblank}")
    @Pattern(groups = {Add.class, Mod.class}, regexp = "^(create|update|delete|order_change)$", 
             message = "{datacloud.script.step.history.change.type.pattern}")
    private String changeType;

    /**
     * 变更详情（JSON格式）
     */
    private String changeDetails;

    /**
     * 企业ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.script.step.history.enterprise.notnull}")
    private Long enterpriseId;

    /**
     * 创建人ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.script.step.history.creator.notnull}")
    private Long creatorId;

    /**
     * 创建时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date createTime;
}
