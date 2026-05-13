package com.iwhalecloud.byai.state.domain.chat.enums;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public enum ChatUseageEnum {
    USER_INPUT(1, "用户输入"),
    SYSTEM_RESPONSE(2, "系统回答"),
    SYSTEM_FOLLOW(3, "系统追问"),
    FORWARD_TYPE(4, "转发消息"),
    ADD_OR_DEL_MEM(5, "创建群、入群或移除群通知消息"),;

    private Integer code;

    private String name;

    public String getName(Integer code) {
        for (ChatUseageEnum item : ChatUseageEnum.values()) {
            if (item.getCode().equals(code)) {
                return item.getName();
            }
        }

        return null;
    }
}
