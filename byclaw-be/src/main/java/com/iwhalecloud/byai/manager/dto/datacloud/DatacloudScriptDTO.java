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
 * 脚本采集管理DTO
 * 
 * @author system
 * @date 2025-01-15
 */
@Data
public class DatacloudScriptDTO {

    /**
     * 脚本主键ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = Mod.class, message = "{datacloud.script.id.notnull}")
    private Long scriptId;


    /**
     * 关联视图ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long viewId;

    /**
     * 脚本名称
     */
    @NotBlank(groups = {Add.class, Mod.class}, message = "{datacloud.script.name.notblank}")
    @Size(groups = {Add.class, Mod.class}, max = 255, message = "{datacloud.script.name.size}")
    private String scriptName;

    /**
     * 脚本类型：playwright、api
     */
    @NotBlank(groups = {Add.class, Mod.class}, message = "{datacloud.script.type.notblank}")
    @Pattern(groups = {Add.class, Mod.class}, regexp = "^(playwright|api)$", 
             message = "{datacloud.script.type.pattern}")
    private String scriptType;

    /**
     * 脚本描述
     */
    private String scriptDescription;

    /**
     * 脚本内容（带变量的模板）
     */
    @NotBlank(groups = {Add.class, Mod.class}, message = "{datacloud.script.content.notblank}")
    private String scriptContent;

    /**
     * 脚本状态：active、inactive、draft
     */
    @NotBlank(groups = {Add.class, Mod.class}, message = "{datacloud.script.status.notblank}")
    @Pattern(groups = {Add.class, Mod.class}, regexp = "^(active|inactive|draft)$", 
             message = "{datacloud.script.status.pattern}")
    private String scriptStatus;

    /**
     * 关联场景ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long scenarioId;

    /**
     * 企业ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.script.enterprise.notnull}")
    private Long enterpriseId;

    /**
     * 创建人ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.script.creator.notnull}")
    private Long creatorId;

    /**
     * 创建时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date createTime;

    /**
     * 更新者ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long updateBy;

    /**
     * 更新时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date updateTime;

    /**
     * 脚本版本号
     */
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.script.version.notnull}")
    private Integer version;

    /**
     * 标签，多个用逗号分隔
     */
    @Size(groups = {Add.class, Mod.class}, max = 500, message = "{datacloud.script.tags.size}")
    private String tags;

    /**
     * 关联步骤数量
     */
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.script.step.count.notnull}")
    private Integer stepCount;

    // 扩展字段，用于显示

    /**
     * 场景名称（用于显示）
     */
    private String scenarioName;

    /**
     * 登录类型名称（用于显示）
     */
    private String loginTypeName;

    /**
     * 分类名称（用于显示）
     */
    private String categoryName;

    /**
     * 创建人姓名（用于显示）
     */
    private String creatorName;

    /**
     * 更新人姓名（用于显示）
     */
    private String updateByName;

    /**
     * 最后执行时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date lastExecutionTime;

    /**
     * 执行次数
     */
    private Integer executionCount;

    /**
     * 成功次数
     */
    private Integer successCount;

    /**
     * 失败次数
     */
    private Integer failCount;
}
