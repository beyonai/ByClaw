package com.iwhalecloud.byai.state.domain.agent.enums;

/**
 * @author he.duming
 * @date 2025-11-12 00:26:52
 * @description TODO
 */
public final class StatusFilterType {

    private StatusFilterType() {

    }

    /**
     * 全部状态
     */
    public static final String ALL = "ALL";

    /**
     * 被授权（获得使用权限的数字员工，不含自主申请）
     */
    public static final String AUTHORIZED = "AUTHORIZED";

    /**
     * 已过审（自主申请审核通过可使用的数字员工）
     */
    public static final String APPROVED = "APPROVED";

    /**
     * 审核中（待审核的数字员工）
     */
    public static final String AUDITING = "AUDITING";

    /**
     * 可申请（未获权限但可发起申请的数字员工）
     */
    public static final String APPLY_AVAILABLE = "APPLY_AVAILABLE";
}
