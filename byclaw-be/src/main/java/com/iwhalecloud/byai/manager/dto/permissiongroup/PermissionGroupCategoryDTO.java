package com.iwhalecloud.byai.manager.dto.permissiongroup;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

/**
 * 权限组目录数据传输对象
 */
@Getter
@Setter
public class PermissionGroupCategoryDTO {

    /**
     * 目录ID（更新时必填）
     */
    private Long id;

    /**
     * 目录名称
     */
    @NotEmpty(message = "{permissiongroupcategory.categoryname.notempty}")
    @Size(max = 255, message = "{permissiongroupcategory.categoryname.size}")
    private String categoryName;

    /**
     * 父级目录ID（NULL表示顶级目录）
     */
    private Long parentId;

    /**
     * 目录编码
     */
    @Size(max = 128, message = "{permissiongroupcategory.categorycode.size}")
    private String categoryCode;

    /**
     * 目录描述
     */
    @Size(max = 500, message = "{permissiongroupcategory.description.size}")
    private String description;

    /**
     * 图标
     */
    @Size(max = 128, message = "{permissiongroupcategory.icon.size}")
    private String icon;

    /**
     * 排序顺序
     */
    private Integer sortOrder;

    /**
     * 状态：active-启用, inactive-禁用
     */
    private String status;

    /**
     * 组织ID
     */
    private Long orgId;

}

