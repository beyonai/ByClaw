package com.iwhalecloud.byai.manager.entity.template;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Data;

import java.util.Date;

/**
 * 资源模版关联关系表
 * 
 * @author system
 * &#064;date  2025-01-XX
 */
@Data
@TableName("resource_template_relation")
public class ResourceTemplateRelation {

    /**
     * 资源模版关联ID（主键）
     */
    @TableId(value = "resource_template_id")
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceTemplateId;

    /**
     * 模版ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long templateId;

    /**
     * 资源ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    /**
     * 创建时间
     */
    private Date createTime;

    /**
     * 创建人
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long createBy;

    /**
     * 同步记忆引擎规则id
     */
    private String memoryRuleId;
}

