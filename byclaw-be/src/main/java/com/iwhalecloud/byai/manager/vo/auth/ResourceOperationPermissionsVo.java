package com.iwhalecloud.byai.manager.vo.auth;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Getter;
import lombok.Setter;

/**
 * 当前登录用户对单个资源的操作权限。
 * 与列表查询返回的 canEdit/canManageAuth 等字段语义一致。
 *
 * @author qin.guoquan
 * @date 2026-05-06
 */
@Getter
@Setter
public class ResourceOperationPermissionsVo {

    /**
     * 资源 ID。
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    /**
     * 资源归属类型：personal / personal_default / enterprise。
     */
    private String ownerType;

    /**
     * 资源业务类型：DIG_EMPLOYEE / KG_DOC / TOOLKIT 等。
     */
    private String resourceBizType;

    /**
     * 是否具备资源管理权限。
     */
    private boolean hasManagePermission;

    /**
     * 是否具备资源使用权限。
     */
    private boolean hasUsePermission;

    /**
     * 是否允许进入资源详情。
     */
    private boolean canViewDetail;

    /**
     * 是否可编辑信息。
     */
    private boolean canEdit;

    /**
     * 是否可管理授权（设置资源管理员）。
     */
    private boolean canManageAuth;

    /**
     * 是否可设置使用授权（设置可使用本资源的成员）。
     */
    private boolean canUseAuth;

    /**
     * 是否可注销资源。
     */
    private boolean canDelete;

    /**
     * 是否可发起使用申请。
     */
    private boolean canApplyUse;

    /**
     * 当前用户是否已有待审核的使用申请。
     */
    private boolean useApplyPending;

    /**
     * 是否可审核使用申请。
     */
    private boolean canAuditUse;

    /**
     * 是否可设为默认（仅数字员工类型有意义，其他业务类型为 false）。
     */
    private boolean canSetDefault;

    /**
     * 是否可恢复资源（仅当资源状态为已注销时为 true）。
     */
    private boolean canRestore;

    /**
     * 是否可上架。仅数字员工且当前为已下架、具备管理权限时为 true。
     */
    private boolean canOnShelf;

    /**
     * 是否可下架。仅数字员工且当前为已上架、具备管理权限时为 true。
     */
    private boolean canOffShelf;
}
