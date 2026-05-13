package com.iwhalecloud.byai.common.constants.feign.knowledge;

/**
 * 审批类型常量
 *
 * @author he.duming
 * @date 2025-12-13 14:41:03
 */
public final class ApprovalType {

    private ApprovalType() {
    }

    /**
     * 上架申请
     */
    public static final String SHELF_APPLY = "1";

    /**
     * 下架申请
     */
    public static final String UN_SHELF_APPLY = "2";

    /**
     * 订阅申请
     */
    public static final String SUBSCRIPTION_APPLY = "3";
}
