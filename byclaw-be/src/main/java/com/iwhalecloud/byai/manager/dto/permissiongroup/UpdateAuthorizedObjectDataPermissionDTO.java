package com.iwhalecloud.byai.manager.dto.permissiongroup;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

import java.util.List;
import java.util.Map;

/**
 * 更新授权对象数据权限数据传输对象
 * 用于单独更新权限组中某个用户的数据权限配置
 */
@Getter
@Setter
public class UpdateAuthorizedObjectDataPermissionDTO {

    /**
     * 权限组ID
     */
    @NotNull(message = "{permissiongroup.id.notnull}")
    private Long permissionGroupId;

    /**
     * 用户ID
     */
    @NotNull(message = "{user.id.notnull}")
    private Long userId;

    /**
     * 数据权限配置数组（后端会序列化为JSON字符串存储）
     */
    @NotNull(message = "permissions数组不能为空")
    @Valid
    private List<DataPermissionItem> permissions;

    /**
     * 数据权限配置项
     */
    @Getter
    @Setter
    public static class DataPermissionItem {

        /**
         * 数据范围类型：self-本人、org-组织、position-岗位、station-驻地
         */
        @NotNull(message = "数据范围类型不能为空")
        private String dataScopeType;

        /**
         * 对象ID列表（根据dataScopeType确定对象类型）
         */
        private List<String> objList;

        private List<Map<String, String>> objInfoList;
    }

}
