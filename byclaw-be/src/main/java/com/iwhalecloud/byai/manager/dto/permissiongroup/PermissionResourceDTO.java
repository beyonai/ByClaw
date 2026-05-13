package com.iwhalecloud.byai.manager.dto.permissiongroup;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * 权限资源配置数据传输对象
 * 用于配置功能权限
 */
@Getter
@Setter
public class PermissionResourceDTO {

    /**
     * 资源ID
     */
    private Long resourceId;

    /**
     * 资源类型
     */
    private String resourceType;

    /**
     * 权限类型列表：read-查看, write-编辑, delete-删除, export-导出, execute-执行, manage-管理
     */
    private List<String> permissionTypes;

}

