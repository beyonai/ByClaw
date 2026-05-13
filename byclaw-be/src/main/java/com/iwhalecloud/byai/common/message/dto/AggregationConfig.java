package com.iwhalecloud.byai.common.message.dto;

import lombok.Data;

import java.util.Map;

/**
 * 指标查询聚合配置
 */
@Data
public class AggregationConfig {

    /** 聚合类型：valueCount, avg, sum, cardinality, filter, bucket_script 等 */
    private String type;

    /** 字段名 */
    private String field;

    /** 过滤条件（用于 filter 聚合） */
    private FilterConfig filter;

    /** 子聚合配置 */
    private Map<String, AggregationConfig> subAggregations;

    /** Bucket Script 的路径映射 */
    private Map<String, String> bucketsPath;

    /** Bucket Script 脚本 */
    private String script;

    /** Bucket Script 脚本语言，默认 painless */
    private String scriptLang;

}
