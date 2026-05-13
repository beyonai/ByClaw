package com.iwhalecloud.byai.state.domain.session.dto;

import lombok.Data;

@Data
public class SortField {

    /**
     * 排序字段名
     */
    private String field;

    /**
     * 排序方式，默认降序
     */
    private String order = "desc";

    /**
     * 排序优先级（数字越小优先级越高）
     */
    private Integer priority = 1;

}
