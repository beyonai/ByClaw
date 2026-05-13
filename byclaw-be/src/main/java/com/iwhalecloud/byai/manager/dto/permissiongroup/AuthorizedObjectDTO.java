package com.iwhalecloud.byai.manager.dto.permissiongroup;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;
import java.util.List;

/**
 * 授权对象数据传输对象
 * 用于添加授权对象到权限组
 */
@Getter
@Setter
public class AuthorizedObjectDTO {

    /**
     * 权限组ID
     */
    @NotNull(message = "{permissiongroup.id.notnull}")
    private Long permissionGroupId;

    /**
     * 授权对象列表
     */
    @NotEmpty(message = "{authorizedobject.list.notempty}")
    private List<AuthorizedObjectItem> authorizedObjects;

    /**
     * 授权对象项
     */
    @Getter
    @Setter
    public static class AuthorizedObjectItem {

        /**
         * 对象ID
         */
        @NotNull(message = "{authorizedobject.objectid.notnull}")
        private Long objectId;

        /**
         * 对象类型：user-用户, org-组织, role-角色, position-岗位
         */
        @NotEmpty(message = "{authorizedobject.objecttype.notempty}")
        private String objectType;

        /**
         * 对象名称
         */
        private String objectName;

        /**
         * 授权开始时间
         */
        private Date effectiveFrom;

        /**
         * 授权结束时间
         */
        private Date effectiveTo;

    }

}

