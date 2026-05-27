package com.iwhalecloud.byai.state.common.dto;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2026-05-26 20:31:09
 * @description TODO
 */
@Getter
@Setter
public class MessageStructDto {

    /**
     * messageStruct:结构,inferLog:思考过程
     */
    private String updateField;

    private Long messageId;

    private String id;

    private String content;
}
