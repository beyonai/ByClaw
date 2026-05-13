package com.iwhalecloud.byai.manager.dto.permissiongroup;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

/**
 * 权限组基本信息数据传输对象
 * 用于单独更新权限组基本信息
 */
@Getter
@Setter
public class PermissionGroupBasicInfoDTO {

    /**
     * 权限组ID
     */
    @NotNull(message = "{permissiongroup.id.notnull}")
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

}

