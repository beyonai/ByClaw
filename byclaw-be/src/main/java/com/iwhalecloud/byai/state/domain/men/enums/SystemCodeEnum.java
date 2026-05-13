package com.iwhalecloud.byai.state.domain.men.enums;

import lombok.Getter;

/**
 * 来源系统编码枚举
 * BYAI：百应，BOT：博特，WHALE+：鲸+，UIAGENT：界面智能体
 */
@Getter
public enum SystemCodeEnum {
    BYAI("BYAI", "百应"),
    BOT("BOT", "博特"),
    WHALE_PLUS("WHALE+", "鲸+"),
    UIAGENT("UIAGENT", "界面智能体"),
    SANDBOX("SANDBOX", "沙箱");

    private final String code;
    private final String desc;

    SystemCodeEnum(String code, String desc) {
        this.code = code;
        this.desc = desc;
    }
} 