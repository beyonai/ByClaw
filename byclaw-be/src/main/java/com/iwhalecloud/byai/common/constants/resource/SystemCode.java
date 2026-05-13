package com.iwhalecloud.byai.common.constants.resource;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * 外系统编码枚举
 */
@RequiredArgsConstructor
@Getter
public enum SystemCode {

    BYAI("BYAI", "百应"),
    WHAGE_AGENT("WHALE_AGENT", "老智能体"),
    BOT("BOT", "博特"),
    DIFY("DIFY", "DIFY"),
    DINGTALK("dingtalk", "钉钉"),
    IWHALE("iwhale", "鲸加"),
    OTHER("other", "其他");

    private final String code;
    private final String desc;

    /**
     * 校验系统编码是否有效
     */
    public static boolean isValid(String code) {
        if (code == null || code.trim().isEmpty()) {
            return false;
        }

        for (SystemCode systemCode : values()) {
            if (systemCode.code.equalsIgnoreCase(code)) {
                return true;
            }
        }
        return false;
    }


}
