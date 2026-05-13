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
 * 脚本主表实体�?
 * 用于管理playwright、api脚本的采集管�?
 * 
 * @author system
 * @date 2025-01-15
 */
@Data
@TableName("datacloud_script")
public class DatacloudScript implements Serializable {

    private static final long serialVersionUID = 1L;

    /**
     * 脚本主键ID
     */
    @TableId(type = IdType.INPUT)
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = Mod.class, message = "{datacloud.script.id.notnull}")
    private Long scriptId;

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
     * 关联视图ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long viewId;

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
     * 脚本版本�?
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

    /**
     * 发布状态：0-草稿�?-已发布，2-未发�?
     */
    private Integer publishStatus;
}
