package com.iwhalecloud.byai.manager.dto.permissiongroup;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * 资源属性权限数据传输对象
 * 用于配置资源属性与数据权限范围的映射关系
 * 注意：resourceId 在外层 UpdateResourceAttributePermissionDTO 中指定
 */
@Getter
@Setter
public class ResourceAttributePermissionDTO {

    /**
     * 资源属性ID
     */
    @NotNull(message = "{permissiongroupresourceattribute.resourceattributeid.notnull}")
    private Long resourceAttributeId;

    /**
     * 数据范围类型：self-本人、org-组织、position-岗位、station-驻地等
     * 用于定义该属性对应的数据权限范围
     */
    @NotNull(message = "{permissiongroupresourceattribute.datascopetype.notnull}")
    private String dataScopeType;

}

