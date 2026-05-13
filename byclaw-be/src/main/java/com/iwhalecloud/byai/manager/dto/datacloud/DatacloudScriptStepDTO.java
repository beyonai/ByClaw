package com.iwhalecloud.byai.manager.dto.datacloud;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import com.iwhalecloud.byai.common.annotation.Add;
import com.iwhalecloud.byai.common.annotation.Mod;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

import java.util.Date;

/**
 * 脚本步骤管理DTO
 * 
 * @author system
 * @date 2025-01-15
 */
@Data
public class DatacloudScriptStepDTO {

    /**
     * 步骤主键ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = Mod.class, message = "{datacloud.script.step.id.notnull}")
    private Long stepId;

    /**
     * 关联脚本ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.script.step.script.id.notnull}")
    private Long scriptId;

    /**
     * 关联的模板ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long templateId;

    /**
     * 脚本内容（JSON格式，包含nodejs和python）
     */
    @NotBlank(groups = {Add.class, Mod.class}, message = "{datacloud.script.step.content.notblank}")
    private String scriptContent;

    /**
     * 参数变量定义（JSON格式）
     */
    private String metaInfos;

    /**
     * 步骤顺序
     */
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.script.step.order.notnull}")
    private Integer stepOrder;


    /**
     * 企业ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.script.step.enterprise.notnull}")
    private Long enterpriseId;

    /**
     * 创建人ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.script.step.creator.notnull}")
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

    // 扩展字段，用于显示

    /**
     * 脚本名称（用于显示）
     */
    private String scriptName;

    /**
     * 创建人姓名（用于显示）
     */
    private String creatorName;

    /**
     * 更新人姓名（用于显示）
     */
    private String updateByName;

    /**
     * 脚本内容对象（解析后的JSON对象）
     */
    private Object scriptContentObj;

    /**
     * 参数变量定义对象（解析后的JSON对象）
     */
    private Object metaInfosObj;
}
