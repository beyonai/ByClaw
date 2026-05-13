package com.iwhalecloud.byai.gateway.channels.enums;

import lombok.Getter;

/**
 * 渠道类型枚举
 *
 * @author byai
 * @version 1.0
 * @date 2026/4/7
 */
@Getter
public enum ChannelType {

    /**
     * App 渠道
     */
    APP("app", "App渠道"),

    /**
     * 钉钉渠道
     */
    DINGTALK("dingtalk", "钉钉渠道"),

    /**
     * Web 渠道
     */
    WEB("web", "Web渠道");

    private final String code;
    private final String desc;

    ChannelType(String code, String desc) {
        this.code = code;
        this.desc = desc;
    }

    /**
     * 根据 code 获取枚举
     *
     * @param code 渠道代码
     * @return ChannelType
     */
    public static ChannelType getByCode(String code) {
        for (ChannelType type : values()) {
            if (type.getCode().equalsIgnoreCase(code)) {
                return type;
            }
        }
        return null;
    }
}
