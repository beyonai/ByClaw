package com.iwhalecloud.byai.state.domain.resource.dto;

import lombok.Data;

import java.util.List;

/**
 * 参数描述结构，用于前端交互展示和用户补全描述
 */
@Data
public class ParamField {

    /**
     * 参数名
     */
    private String name;

    /**
     * 数据类型: string/integer/number/boolean/object/array
     */
    private String type;

    /**
     * 示例值（从 curl 中提取）
     */
    private String example;

    /**
     * 参数描述（用户填写）
     */
    private String description;

    /**
     * 是否必填
     */
    private Boolean required;

    /**
     * 嵌套对象的子字段（type=object 或 type=array 时使用）
     */
    private List<ParamField> children;
}
