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
 * 脚本场景表实体类
 * 用于管理脚本的分类目录和场景信息
 * 
 * @author system
 * @date 2025-01-15
 */
@Data
@TableName("datacloud_script_scenario")
public class DatacloudScriptScenario implements Serializable {

    private static final long serialVersionUID = 1L;

    /**
     * 场景主键ID
     */
    @TableId(type = IdType.INPUT)
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = Mod.class, message = "{datacloud.scenario.id.notnull}")
    private Long scenarioId;

    /**
     * 场景名称
     */
    @NotBlank(groups = {Add.class, Mod.class}, message = "{datacloud.scenario.name.notblank}")
    @Size(groups = {Add.class, Mod.class}, max = 255, message = "{datacloud.scenario.name.size}")
    private String scenarioName;

    /**
     * 场景描述
     */
    private String scenarioDescription;

    /**
     * 场景编码
     */
    @NotBlank(groups = {Add.class, Mod.class}, message = "{datacloud.scenario.code.notblank}")
    @Pattern(groups = {Add.class, Mod.class}, regexp = "^[a-zA-Z0-9_]{3,100}$", 
             message = "{datacloud.scenario.code.pattern}")
    private String scenarioCode;

    /**
     * 目标URL
     */
    private String targetUrl;

    /**
     * 归属系统
     */
    private String attributionSystem;

    /**
     * 父场景ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long parentId;

    /**
     * 关联的登录类型ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long loginTypeId;

    /**
     * 排序
     */
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.scenario.order.notnull}")
    private Integer scenarioOrder;

    /**
     * 企业ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.scenario.enterprise.notnull}")
    private Long enterpriseId;

    /**
     * 创建人ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.scenario.creator.notnull}")
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
