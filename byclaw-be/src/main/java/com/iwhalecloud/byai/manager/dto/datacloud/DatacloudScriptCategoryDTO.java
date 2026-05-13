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
 * 脚本分类管理DTO
 * 
 * @author system
 * @date 2025-01-15
 */
@Data
public class DatacloudScriptCategoryDTO {

    /**
     * 分类主键ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = Mod.class, message = "{datacloud.script.category.id.notnull}")
    private Long categoryId;

    /**
     * 分类名称
     */
    @NotBlank(groups = {Add.class, Mod.class}, message = "{datacloud.script.category.name.notblank}")
    @Size(groups = {Add.class, Mod.class}, max = 100, message = "{datacloud.script.category.name.size}")
    private String categoryName;

    /**
     * 分类编码
     */
    @NotBlank(groups = {Add.class, Mod.class}, message = "{datacloud.script.category.code.notblank}")
    @Pattern(groups = {Add.class, Mod.class}, regexp = "^[a-zA-Z0-9_]{3,50}$", 
             message = "{datacloud.script.category.code.pattern}")
    private String categoryCode;

    /**
     * 父分类ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long parentId;

    /**
     * 分类描述
     */
    private String categoryDescription;

    /**
     * 排序
     */
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.script.category.order.notnull}")
    private Integer categoryOrder;

    /**
     * 企业ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.script.category.enterprise.notnull}")
    private Long enterpriseId;

    /**
     * 创建人ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.script.category.creator.notnull}")
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
     * 父分类名称（用于显示）
     */
    private String parentCategoryName;

    /**
     * 子分类数量
     */
    private Integer childCount;

    /**
     * 关联脚本数量
     */
    private Integer scriptCount;

    /**
     * 创建人姓名（用于显示）
     */
    private String creatorName;

    /**
     * 更新人姓名（用于显示）
     */
    private String updateByName;
}
