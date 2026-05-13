package com.iwhalecloud.byai.manager.dto.permissiongroup;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * 维度列表权限查询数据传输对象
 * 用于检查当前用户是否有访问指定数据实例列表的权限
 */
@Getter
@Setter
public class DimensionListPermissionQueryDTO {

    /**
     * 权限组ID列表
     */
    @NotEmpty(message = "权限组ID列表不能为空")
    private List<Long> permissionGroupIds;

    /**
     * 维度类型：user-用户, org-组织, position-岗位, station-驻地
     */
    @NotNull(message = "维度类型不能为空")
    private String dimensionType;

    /**
     * 数据实例ID列表
     */
    @NotEmpty(message = "数据实例ID列表不能为空")
    private List<String> objIds;

}
