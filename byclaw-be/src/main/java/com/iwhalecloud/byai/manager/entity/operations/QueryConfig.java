package com.iwhalecloud.byai.manager.entity.operations;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.util.Date;
import lombok.Getter;
import lombok.Setter;

/**
 * 查询配置实体?
 * 用于配置运营看板的动态SQL查询模板
 * 
 * @author ByAI Team
 * @date 2025-10-30
 */
@Getter
@Setter
@TableName("byai.query_config")
public class QueryConfig {

    /**
     * 查询配置ID
     */
    @TableId(value = "query_id", type = IdType.INPUT)
    private Long queryId;

    /**
     * 查询编码，用于唯一标识查询配置
     */
    private String queryCode;

    /**
     * 查询名称
     */
    private String name;

    /**
     * 查询描述，用于说明查询的用途和说明
     */
    private String description;

    /**
     * SQL模板，支持MyBatis参数化语?#{参数名}
     * 例如：SELECT * FROM table WHERE date >= #{startDate} AND date <= #{endDate}
     */
    private String sqlTemplate;

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

    /**
     * 查询类型，用于区分日/?月查询：DAY, WEEK, MONTH
     * 如果为null，则表示支持所有类?
     */
    private String queryType;

    /**
     * DB类型，用于描述查询的数据库类型 MYSQL, ORACLE, POSTGRESQL
     */
    private String dbType = "POSTGRESQL";

    /**
     *  查询方式 DB,ES
     */
    private String queryMethod = "DB";

    /**
     * 状态：1-启用）-禁用
     */
    private Integer status;

    /**
     * 创建时间
     */
    private Date createdTime;

    /**
     * 更新时间
     */
    private Date updatedTime;

    /**
     * 创建人
     */
    private String createdBy;
}
