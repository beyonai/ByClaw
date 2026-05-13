package com.iwhalecloud.byai.state.domain.message.enums;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

@RequiredArgsConstructor
@Getter
public enum MsgStatus {
    /**
     * 结束
     */
    FINISH(0),
    /**
     * 追加模式
     */
    APPEND(1);

    private final Integer code;
}
