package com.iwhalecloud.byai.manager.dto.operations;

import lombok.Getter;
import lombok.Setter;

/**
 * 查询配置列表DTO
 * 用于返回查询配置的列表信息，不包含SQL模板
 * 
 * @author ByAI Team
 * @date 2025-11-15
 */
@Getter
@Setter
public class QueryConfigListDTO {

    /**
     * 查询编码，用于唯一标识查询配置
     */
    private String queryCode;

    /**
     * 查询名称
     */
    private String queryName;

    /**
     * 维度字段，JSON格式存储，用于描述查询的维度信息
     * 例如：["date", "org_id", "agent_id"]
     */
    private String dimensionFields;

    /**
     * 度量字段，JSON格式存储，用于描述查询的度量信息
     * 例如：["service_count", "active_rate", "user_count"]
     */
    private String measureFields;

    /**
     * 条件字段，JSON格式存储，用于描述查询的条件参数
     * 例如：["startDate", "endDate", "orgId", "agentId"]
     */
    private String conditionFields;
}

