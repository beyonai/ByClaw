package com.iwhalecloud.byai.manager.dto.permissiongroup;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;
import java.util.List;

/**
 * 排除对象数据传输对象
 * 用于添加排除对象到权限组
 */
@Getter
@Setter
public class ExcludedObjectDTO {

    /**
     * 权限组ID
     */
    @NotNull(message = "{permissiongroup.id.notnull}")
    private Long permissionGroupId;

    /**
     * 排除对象列表
     */
    @NotEmpty(message = "{excludedobject.list.notempty}")
    private List<ExcludedObjectItem> excludedObjects;

    /**
     * 排除对象项
     */
    @Getter
    @Setter
    public static class ExcludedObjectItem {

        /**
         * 对象ID
         */
        @NotNull(message = "{excludedobject.objectid.notnull}")
        private Long objectId;

        /**
         * 对象类型：user-用户, org-组织, role-角色, position-岗位
         */
        @NotEmpty(message = "{excludedobject.objecttype.notempty}")
        private String objectType;

        /**
         * 对象名称
         */
        private String objectName;

        /**
         * 排除开始时间
         */
        private Date effectiveFrom;

        /**
         * 排除结束时间
         */
        private Date effectiveTo;

    }

}
