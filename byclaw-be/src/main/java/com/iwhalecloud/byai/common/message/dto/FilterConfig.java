package com.iwhalecloud.byai.common.message.dto;

import lombok.Data;

import java.util.Map;

/**
 * 指标查询过滤器配置
 */
@Data
public class FilterConfig {

    /** 过滤器类型：term, range 等 */
    private String type;

    /** 字段名 */
    private String field;

    /** 值（用于 term 查询） */
    private Object value;

    /** 范围值（用于 range 查询）：gte, lte 等 */
    private Map<String, Object> range;

    /** 格式（用于日期范围查询） */
    private String format;

}
