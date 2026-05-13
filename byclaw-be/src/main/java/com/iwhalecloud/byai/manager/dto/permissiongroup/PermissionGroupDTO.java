package com.iwhalecloud.byai.manager.dto.permissiongroup;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * 权限组数据传输对象
 * 用于新增和修改权限组
 */
@Getter
@Setter
public class PermissionGroupDTO {

    /**
     * 权限组ID（修改时必填）
     */
    private Long id;

    /**
     * 权限组编码
     */
    @NotEmpty(message = "{permissiongroup.groupcode.notempty}")
    @Size(max = 100, message = "{permissiongroup.groupcode.size}")
    private String groupCode;

    /**
     * 权限组名称
     */
    @NotEmpty(message = "{permissiongroup.groupname.notempty}")
    @Size(max = 200, message = "{permissiongroup.groupname.size}")
    private String groupName;

    /**
     * 权限组描述
     */
    @Size(max = 500, message = "{permissiongroup.description.size}")
    private String description;

    /**
     * 状态：active-启用, inactive-禁用
     */
    private String status;

    /**
     * 所属组织ID
     */
    private Long orgId;

    /**
     * 父权限组ID（支持层级结构）
     */
    private Long parentId;

    /**
     * 分类ID
     */
    private Long categoryId;

    /**
     * 功能权限配置列表
     */
    private List<PermissionResourceDTO> resourcePermissions;

    /**
     * 数据权限配置
     */
    private DataPermissionDTO dataPermission;

}

