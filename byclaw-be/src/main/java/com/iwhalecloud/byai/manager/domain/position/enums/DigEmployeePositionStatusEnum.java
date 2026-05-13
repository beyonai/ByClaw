package com.iwhalecloud.byai.manager.domain.position.enums;

import lombok.Getter;

/**
 * 数字员工岗位状态枚举
 */
@Getter
public enum DigEmployeePositionStatusEnum {

    /**
     * 下岗
     */
    OFF_JOB(0, "下岗"),

    /**
     * 上岗
     */
    ON_JOB(1, "上岗"),

    /**
     * 申请上岗
     */
    APPLY_JOB(2, "申请上岗"),

    /**
     * 拒绝上岗
     */
    REFUSE_JOB(3, "拒绝上岗");

    private final Integer code;
    private final String name;

    DigEmployeePositionStatusEnum(Integer code, String name) {
        this.code = code;
        this.name = name;
    }

    /**
     * 根据编码获取枚举
     *
     * @param code 编码
     * @return 枚举
     */
    public static DigEmployeePositionStatusEnum getByCode(Integer code) {
        for (DigEmployeePositionStatusEnum status : values()) {
            if (status.getCode().equals(code)) {
                return status;
            }
        }
        return null;
    }
}