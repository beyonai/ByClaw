package com.iwhalecloud.byai.manager.vo.permissiongroup;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.List;

/**
 * 维度列表权限视图对象
 * 返回当前用户是否有访问指定数据实例列表的权限
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class DimensionListPermissionVO {

    /**
     * 是否有权限访问所有指定的数据实例
     */
    private Boolean hasPermission;

    /**
     * 维度类型：user-用户, org-组织, position-岗位, station-驻地
     */
    private String dimensionType;

    /**
     * 有权限访问的数据实例ID列表
     */
    private List<String> accessibleObjIds;

    /**
     * 无权限访问的数据实例ID列表
     */
    private List<String> inaccessibleObjIds;

}
