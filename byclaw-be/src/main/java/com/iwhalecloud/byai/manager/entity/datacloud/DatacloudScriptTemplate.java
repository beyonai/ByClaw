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
import jakarta.validation.constraints.Size;
import lombok.Data;

import java.io.Serializable;
import java.util.Date;

/**
 * 脚本模板表实体类
 * 用于管理脚本模板，包含Python和NodeJS模板内容
 * 
 * @author system
 * @date 2025-01-15
 */
@Data
@TableName("datacloud_script_template")
public class DatacloudScriptTemplate implements Serializable {

    private static final long serialVersionUID = 1L;

    /**
     * 模板主键ID
     */
    @TableId(type = IdType.INPUT)
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = Mod.class, message = "{datacloud.script.template.id.notnull}")
    private Long templateId;

    /**
     * 模板名称
     */
    @NotBlank(groups = {Add.class, Mod.class}, message = "{datacloud.script.template.name.notblank}")
    @Size(groups = {Add.class, Mod.class}, max = 255, message = "{datacloud.script.template.name.size}")
    private String templateName;

    /**
     * 脚本组件类型
     */
    @NotBlank(groups = {Add.class, Mod.class}, message = "{datacloud.script.template.type.notblank}")
    @Size(groups = {Add.class, Mod.class}, max = 50, message = "{datacloud.script.template.type.size}")
    private String templateType;

    /**
     * 脚本框架类型
     */
    @NotBlank(groups = {Add.class, Mod.class}, message = "{datacloud.script.template.framework.notblank}")
    @Size(groups = {Add.class, Mod.class}, max = 50, message = "{datacloud.script.template.framework.size}")
    private String framework;

    /**
     * Python脚本模板内容
     */
    private String pyTemplateContent;

    /**
     * NodeJS脚本模板内容
     */
    private String nodeTemplateContent;

    /**
     * 使用到的参数变量定义（JSON格式）
     */
    private String metaInfos;

    /**
     * 模板描述
     */
    private String templateDescription;

    /**
     * 是否启用：0-禁用，1-启用
     */
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.script.template.active.notnull}")
    private Integer isActive;

    /**
     * 企业ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.script.template.enterprise.notnull}")
    private Long enterpriseId;

    /**
     * 创建人ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.script.template.creator.notnull}")
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
}
