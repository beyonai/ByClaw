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
 * 登录类型表实体类
 * 用于管理不同登录方式的配置信息
 * 
 * @author system
 * @date 2025-01-15
 */
@Data
@TableName("datacloud_login_type")
public class DatacloudLoginType implements Serializable {

    private static final long serialVersionUID = 1L;

    /**
     * 登录类型主键ID
     */
    @TableId(type = IdType.INPUT)
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = Mod.class, message = "{datacloud.login.type.id.notnull}")
    private Long loginTypeId;

    /**
     * 登录类型编码
     */
    @NotBlank(groups = {Add.class, Mod.class}, message = "{datacloud.login.type.code.notblank}")
    @Pattern(groups = {Add.class, Mod.class}, regexp = "^[a-zA-Z0-9_]{3,50}$", 
             message = "{datacloud.login.type.code.pattern}")
    private String loginTypeCode;

    /**
     * 登录类型名称
     */
    @NotBlank(groups = {Add.class, Mod.class}, message = "{datacloud.login.type.name.notblank}")
    @Size(groups = {Add.class, Mod.class}, max = 100, message = "{datacloud.login.type.name.size}")
    private String loginTypeName;

    /**
     * 登录类型描述
     */
    private String loginTypeDescription;

    /**
     * 登录类型配置（JSON格式）
     */
    private String loginTypeConfig;

    /**
     * 是否启用：0-禁用，1-启用
     */
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.login.type.active.notnull}")
    private Integer isActive;

    /**
     * 排序
     */
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.login.type.order.notnull}")
    private Integer sortOrder;

    /**
     * 企业ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.login.type.enterprise.notnull}")
    private Long enterpriseId;

    /**
     * 创建人ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.login.type.creator.notnull}")
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
