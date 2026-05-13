package com.iwhalecloud.byai.manager.domain.aimodel.enums;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * 模型状态枚举（API 与库表映射）
 * 接口 status：ENABLED/DISABLED/TESTING；
 * 库表 status：OOA（启用）、OOX（停用/未启用）、OOD（调试中）
 *
 * @author system
 */
@RequiredArgsConstructor
@Getter
public enum ModelStatusEnum {

    /** 启用 */
    ENABLED("OOA"),
    /** 停用/未启用 */
    DISABLED("OOX"),
    /** 调试中 */
    TESTING("OOD");

    /** 库表状态码 */
    private final String dbCode;

    /**
     * API 状态转库表状态
     *
     * @param apiStatus API 状态（ENABLED/DISABLED/TESTING）
     * @return 库表状态码，未匹配返回 null
     */
    public static String toDbCode(String apiStatus) {
        if (apiStatus == null || apiStatus.isEmpty()) {
            return null;
        }
        for (ModelStatusEnum e : values()) {
            if (e.name().equals(apiStatus)) {
                return e.getDbCode();
            }
        }
        return null;
    }

    /**
     * 库表状态转 API 状态
     *
     * @param dbCode 库表状态（OOA/OOX/OOD）
     * @return API 状态，未匹配返回 null
     */
    public static String toApiStatus(String dbCode) {
        if (dbCode == null || dbCode.isEmpty()) {
            return null;
        }
        for (ModelStatusEnum e : values()) {
            if (e.getDbCode().equals(dbCode)) {
                return e.name();
            }
        }
        return null;
    }

    /**
     * 是否为启用状态（需写入 Redis）
     */
    public static boolean isEnabledDb(String dbCode) {
        return "OOA".equals(dbCode);
    }
}
