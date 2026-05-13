package com.iwhalecloud.byai.manager.dto.permissiongroup;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * 更新资源属性权限数据传输对象
 * 用于更新资源属性与数据权限范围的映射关系
 * 按照"资源 + 属性"的粒度进行操作
 */
@Getter
@Setter
public class UpdateResourceAttributePermissionDTO {

    /**
     * 资源ID
     * 指定要更新属性权限的资源
     */
    @NotNull(message = "{resource.id.notnull}")
    private Long resourceId;

    /**
     * 资源属性权限配置列表
     * 该资源下的所有属性与数据权限范围的映射配置
     */
    private List<ResourceAttributePermissionDTO> attributePermissions;

}

