package com.iwhalecloud.byai.state.domain.chat.enums;

import lombok.Getter;

@Getter
public enum ChatRelatedResourceTypeEnum {

    DATASET("DATASET", "知识库"), ON_LINE("ON_LINE", "联网检索"), AGENT("AGENT", "智能助手");

    private final String code;

    private final String msg;

    ChatRelatedResourceTypeEnum(String code, String msg) {
        this.code = code;
        this.msg = msg;
    }
}
