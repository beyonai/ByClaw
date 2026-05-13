package com.iwhalecloud.byai.common.constants.resource;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

@RequiredArgsConstructor
@Getter
public enum OwnershipType {

    // 归属类型：0=授权给我的,1=我创建的，2=我管理的
    OWNER_AUTH(0), OWNER_CREATE(1), OWNER_MANAGER(2);

    private final Integer num;

    public static boolean isExist(Integer ownershipType) {
        for (OwnershipType enumValue : values()) {
            if (enumValue.num.equals(ownershipType)) {
                return true;
            }
        }
        return false;
    }
}
