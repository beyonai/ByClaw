package com.iwhalecloud.byai.state.domain.chat.enums;

import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * 消息ID类型枚举类
 * 用于定义聊天消息的类型标识，区分提问消息和回复消息
 */
@Getter
@AllArgsConstructor
public enum MessageIdTypeEnum {

    /**
     * 提问类型消息
     */
    ASK("ask", "提问"),

    /**
     * 回复类型消息
     */
    RES("res", "回复");

    /**
     * 消息类型编码
     */
    private String code;

    /**
     * 消息类型描述
     */
    private String desc;
}
