package com.iwhalecloud.byai.manager.domain.resource.enums;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * 资源状态枚举。
 * <p>
 * 数值约定：-1=已注销，0=草稿箱，1=待上架（已发布待上架），2=已上架，3=已下架，
 * 4=待上架（审核中），5=审核驳回，6=发布状态。
 */
@RequiredArgsConstructor
@Getter
public enum ResourceStatus {

    /** 已注销（逻辑删除标记，不允许恢复） */
    DELETE(-1),

    /** 草稿箱 */
    DRAFT(0),

    /** 待上架（已发布待上架） */
    RELEASE(1),

    /** 已上架 */
    ON_SHELF(2),

    /** 已下架 */
    OFF_SHELF(3),

    /** 待上架（审核中） */
    AUDIT(4),

    /** 审核驳回 */
    AUDIT_REJECT(5),

    /** 发布状态 */
    PUBLISH(6);

    private final Integer num;

    public static boolean isExist(Integer status) {
        for (ResourceStatus enumValue : values()) {
            if (enumValue.num.equals(status)) {
                return true;
            }
        }
        return false;
    }
}
