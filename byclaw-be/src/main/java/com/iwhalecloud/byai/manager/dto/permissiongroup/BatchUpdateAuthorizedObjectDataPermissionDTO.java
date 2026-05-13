package com.iwhalecloud.byai.manager.dto.permissiongroup;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * 批量更新授权对象数据权限数据传输对象
 * 用于批量更新权限组中多个授权对象的数据权限配置
 */
@Getter
@Setter
public class BatchUpdateAuthorizedObjectDataPermissionDTO {

    /**
     * 权限组ID
     */
    @NotNull(message = "{permissiongroup.id.notnull}")
    private Long permissionGroupId;

    /**
     * 授权对象数据权限配置列表
     */
    @NotNull(message = "{authorizedobject.datapermission.list.notnull}")
    @Size(min = 1, message = "{authorizedobject.datapermission.list.notempty}")
    private List<AuthorizedObjectDataPermissionItemDTO> dataPermissions;

    /**
     * 授权对象数据权限配置项
     */
    @Getter
    @Setter
    public static class AuthorizedObjectDataPermissionItemDTO {

        /**
         * 授权对象ID
         */
        @NotNull(message = "{authorizedobject.id.notnull}")
        private Long authorizedObjectId;

        /**
         * 数据范围类型：self-本人, org-组织, position-岗位, station-驻地
         */
        private String dataScopeType;

        /**
         * 数据范围配置（JSON格式，用于custom类型的自定义配置）
         */
        private String dataScopeConfig;

        /**
         * 字段权限配置（JSON格式，配置可见字段）
         */
        private String fieldPermissions;

        /**
         * 行级权限配置（JSON格式，配置数据过滤条件）
         */
        private String rowPermissions;

    }

}
