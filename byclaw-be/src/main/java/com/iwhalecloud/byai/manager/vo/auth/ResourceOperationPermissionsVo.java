package com.iwhalecloud.byai.manager.vo.auth;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Getter;
import lombok.Setter;

/**
 * 当前登录用户对单个资源的 6 项操作权限。
 * 与列表查询返回的 canEdit/canManageAuth/... 字段语义一致，由
 * {@link com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService#queryResourceOperationPermissions(Long)}
 * 计算返回。
 *
 * @author qin.guoquan
 * @date 2026-05-06
 */
@Getter
@Setter
@Schema(description = "资源操作权限")
public class ResourceOperationPermissionsVo {

    /**
     * 资源 ID。
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @Schema(description = "资源 ID")
    private Long resourceId;

    /**
     * 资源归属类型：personal / personal_default / enterprise。
     */
    @Schema(description = "资源归属类型")
    private String ownerType;

    /**
     * 资源业务类型：DIG_EMPLOYEE / KG_DOC / TOOLKIT 等。
     */
    @Schema(description = "资源业务类型")
    private String resourceBizType;

    /**
     * 是否可编辑信息。
     */
    @Schema(description = "是否可编辑信息")
    private Boolean canEdit;

    /**
     * 是否可管理授权（设置资源管理员）。
     */
    @Schema(description = "是否可管理授权")
    private Boolean canManageAuth;

    /**
     * 是否可设置使用授权（设置可使用本资源的成员）。
     */
    @Schema(description = "是否可设置使用授权")
    private Boolean canUseAuth;

    /**
     * 是否可注销资源。
     */
    @Schema(description = "是否可注销资源")
    private Boolean canDelete;

    /**
     * 是否可发起使用申请。
     */
    @Schema(description = "是否可发起使用申请")
    private Boolean canApplyUse;

    /**
     * 是否可审核使用申请。
     */
    @Schema(description = "是否可审核使用申请")
    private Boolean canAuditUse;

    /**
     * 是否可设为默认（仅数字员工类型有值，其他业务类型为 null）。
     */
    @Schema(description = "是否可设为默认（仅数字员工有效）")
    private Boolean canSetDefault;

    /**
     * 是否可恢复资源（仅当资源状态为已注销时为true）。
     */
    @Schema(description = "是否可恢复资源")
    private Boolean canRestore;
}
