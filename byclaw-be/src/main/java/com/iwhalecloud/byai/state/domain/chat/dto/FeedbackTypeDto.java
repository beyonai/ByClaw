package com.iwhalecloud.byai.state.domain.chat.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class FeedbackTypeDto {
    /**
     * 参数名称
     */
    private String paramName;

    /**
     * 取值
     */
    private String paramValue;

    /**
     * 编码
     */
    private String paramCode;

}
