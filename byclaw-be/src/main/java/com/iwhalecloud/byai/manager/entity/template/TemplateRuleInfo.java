package com.iwhalecloud.byai.manager.entity.template;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Data;

import java.util.Date;

/**
 * 模版规则信息表
 * 
 * @author system
 * @date 2025-01-XX
 */
@Data
@TableName("template_rule_info")
public class TemplateRuleInfo {

    /**
     * 模版ID（主键）
     */
    @TableId(value = "template_id")
    @JsonSerialize(using = ToStringSerializer.class)
    private Long templateId;

    /**
     * 模版类型：超级助手/数字员工
     */
    private String templateType;

    /**
     * 用户ID（创建者id）
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long userId;

    /**
     * 规则名称
     */
    private String ruleName;

    /**
     * 规则内容（text类型）
     */
    private String ruleContent;

    /**
     * 同步记忆引擎规则id
     */
    private Boolean isMemoryTemplate = false;

    /**
     * 更新人
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long updateBy;

    /**
     * 创建时间
     */
    private Date createTime;

    /**
     * 更新时间
     */
    private Date updateTime;
}

