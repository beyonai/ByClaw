package com.iwhalecloud.byai.manager.domain.resource.enums;

import java.util.List;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

@RequiredArgsConstructor
@Getter
public enum ResourceStatus {
    // 资源状态：0=草稿箱，1,4待上架，2=已上架，3=已下架,6=发布状态
    DRAFT(0), RELEASE(1), LIST(2), REMOVED(3), AUDIT(4), AUDIT_REJECT(5), PUBLISH(6);

    private final Integer num;

    public static boolean isExist(Integer status) {
        for (ResourceStatus enumValue : values()) {
            if (enumValue.num.equals(status)) {
                return true;
            }
        }
        return false;
    }

    public static boolean arrIsExist(List<Integer> statusList) {
        for (Integer status : statusList) {
            boolean exist = isExist(status);
            if (!exist) {
                return false;
            }
        }
        return true;
    }
}
