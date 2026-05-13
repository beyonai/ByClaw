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
import lombok.Data;

import java.io.Serializable;
import java.util.Date;

/**
 * 脚本版本历史表实体类
 * 用于记录脚本的版本变更历史
 * 
 * @author system
 * @date 2025-01-15
 */
@Data
@TableName("datacloud_script_history")
public class DatacloudScriptHistory implements Serializable {

    private static final long serialVersionUID = 1L;

    /**
     * 历史记录主键ID
     */
    @TableId(type = IdType.INPUT)
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = Mod.class, message = "{datacloud.script.history.id.notnull}")
    private Long historyId;

    /**
     * 关联脚本ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.script.history.script.id.notnull}")
    private Long scriptId;

    /**
     * 版本号
     */
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.script.history.version.notnull}")
    private Integer version;

    /**
     * 脚本内容
     */
    @NotBlank(groups = {Add.class, Mod.class}, message = "{datacloud.script.history.content.notblank}")
    private String scriptContent;

    /**
     * 变更描述
     */
    private String changeDescription;

    /**
     * 变更类型：create、update、delete、status_change、step_add、step_update、step_delete
     */
    @NotBlank(groups = {Add.class, Mod.class}, message = "{datacloud.script.history.change.type.notblank}")
    @Pattern(groups = {Add.class, Mod.class}, regexp = "^(create|update|delete|status_change|step_add|step_update|step_delete)$", 
             message = "{datacloud.script.history.change.type.pattern}")
    private String changeType;

    /**
     * 变更详情（JSON格式）
     */
    private String changeDetails;

    /**
     * 关联步骤数量
     */
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.script.history.step.count.notnull}")
    private Integer stepCount;

    /**
     * 步骤变更信息（JSON格式）
     */
    private String stepChanges;

    /**
     * 变更前状态
     */
    private String statusBefore;

    /**
     * 变更后状态
     */
    private String statusAfter;

    /**
     * 企业ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.script.history.enterprise.notnull}")
    private Long enterpriseId;

    /**
     * 创建人ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.script.history.creator.notnull}")
    private Long creatorId;

    /**
     * 创建时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date createTime;
}
