package com.iwhalecloud.byai.common.message.dto;

import lombok.Data;

import java.util.List;
import java.util.Map;

/**
 * 指标查询配置
 */
@Data
public class MetricQueryConfig {

    /** 查询过滤器配置 */
    private List<FilterConfig> filters;

    /** 聚合配置 */
    private Map<String, AggregationConfig> aggregations;

    /** 结果映射：聚合名 -> 输出字段名 */
    private Map<String, String> resultMapping;

    /** 是否包含趋势分析 */
    private Boolean includeTrend;

    /** 趋势日期字段 */
    private String trendDateField;

    /** 趋势日期格式 */
    private String trendDateFormat;

    /** 趋势间隔：day/week/month */
    private String trendInterval;

    /** 趋势子聚合配置 */
    private Map<String, AggregationConfig> trendAggregations;

}
