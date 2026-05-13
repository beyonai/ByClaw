package com.iwhalecloud.byai.state.domain.chat.dto;

import lombok.Data;

/**
 * @author zht
 * @version 1.0
 * @date 2025/6/23
 */
@Data
public class MessageFormContentDto {

    /**
     * 表单类型
     */
    private String formType;
    /**
     * 请求类型
     */
    private String requestType;
    /**
     * 字段编码
     */
    private String fieldCode;
    /**
     * 默认值
     */
    private String defaultValue;
    /**
     * 描述
     */
    private String description;
    /**
     * 是否可选
     */
    private Object optional;
    /**
     * 字段类型
     */
    private String fieldType;
    /**
     * 字段值
     */
    private String fieldValue;
    /**
     * 字段名称
     */
    private String fieldName;

    /**
     * 是否只读
     */
    private Boolean readonly;

    /**
     * 是否隐藏
     */
    private Boolean isHidden;
}
