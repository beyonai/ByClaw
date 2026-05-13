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
 * 登录类型管理DTO
 * 
 * @author system
 * @date 2025-01-15
 */
@Data
public class DatacloudLoginTypeDTO {

    /**
     * 登录类型主键ID
     */
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

    // 扩展字段，用于显示

    /**
     * 创建人姓名（用于显示）
     */
    private String creatorName;

    /**
     * 更新人姓名（用于显示）
     */
    private String updateByName;

    /**
     * 关联脚本数量
     */
    private Integer scriptCount;

    /**
     * 登录类型配置对象（解析后的JSON对象）
     */
    private Object loginTypeConfigObj;
}
