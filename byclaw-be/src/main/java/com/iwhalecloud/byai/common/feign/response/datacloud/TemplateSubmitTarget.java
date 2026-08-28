package com.iwhalecloud.byai.common.feign.response.datacloud;

import com.alibaba.fastjson.annotation.JSONField;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Getter;
import lombok.Setter;

/**
 * 工作区模板提交目标上下文。
 */
@Getter
@Setter
public class TemplateSubmitTarget {

    /**
     * 租户 ID
     */
    @JsonProperty("tenant_id")
    @JSONField(name = "tenant_id")
    private String tenantId;

    /**
     * 数据库类型
     */
    @JsonProperty("db_type")
    @JSONField(name = "db_type")
    private String dbType;

    /**
     * 用户编码
     */
    @JsonProperty("user_code")
    @JSONField(name = "user_code")
    private String userCode;

    /**
     * 发布 ID
     */
    @JsonProperty("publish_id")
    @JSONField(name = "publish_id")
    private String publishId;

    /**
     * 本体库 ID
     */
    @JsonProperty("base_id")
    @JSONField(name = "base_id")
    private String baseId;

    /**
     * 数据源别名
     */
    @JsonProperty("datasource_alias")
    @JSONField(name = "datasource_alias")
    private String datasourceAlias;

    /**
     * 连接器类型
     */
    @JsonProperty("connector_type")
    @JSONField(name = "connector_type")
    private String connectorType;

    /**
     * Schema 名称
     */
    @JsonProperty("schema_name")
    @JSONField(name = "schema_name")
    private String schemaName;

    /**
     * 归属类型（如 enterprise）
     */
    @JsonProperty("owner_type")
    @JSONField(name = "owner_type")
    private String ownerType;
}
