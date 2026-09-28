package com.iwhalecloud.byai.manager.qo.auth;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * 资源使用申请审核通过入参。
 * @author qin.guoquan
 * @date 2026-04-25 16:20:00
 */
@Getter
@Setter
public class ResourceUseApplyApproveQo {

    /**
     * 资源标识。
     */
    @NotNull(message = "resourceId不能为空")
    private Long resourceId;

    /**
     * 申请用户标识。
     */
    @NotNull(message = "applyUserId不能为空")
    private Long applyUserId;

    /** 为空时兼容原使用权限审核；SKILL_PUBLICATION 表示技能上架审核。 */
    private String auditType;
}
