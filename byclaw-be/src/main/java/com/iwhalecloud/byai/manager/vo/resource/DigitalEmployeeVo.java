package com.iwhalecloud.byai.manager.vo.resource;

import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDTO;
import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-10-29 01:31:23
 * @description TODO
 */
@Getter
@Setter
public class DigitalEmployeeVo extends DigitalEmployeeDTO {

    /**
     * 所在目录 ID。 列表查询场景直接回传给前端，方便页面展示数字员工所属目录，不影响保存/更新入参结构。
     */
    private Long catalogId;

    private String createUserName;

    private String manOrgName;

    private String manUserName;

    private Long id;

    /**
     * 是否可编辑信息
     */
    private Boolean canEdit;

    /**
     * 是否可管理授权
     */
    private Boolean canManageAuth;

    /**
     * 是否可管理使用授权
     */
    private Boolean canUseAuth;

    /**
     * 是否可注销数据
     */
    private Boolean canDelete;

    /**
     * 是否可发起使用申请
     */
    private Boolean canApplyUse;

    /**
     * 是否可审核使用申请
     */
    private Boolean canAuditUse;

    /**
     * 是否可设为默认个人助理
     */
    private Boolean canSetDefault;

}
