package com.iwhalecloud.byai.manager.qo.template;

import com.iwhalecloud.byai.common.qo.QueryObject;
import lombok.Data;

import java.util.Date;

/**
 * 模版规则信息查询对象
 * 
 * @author system
 * @date 2025-01-XX
 */
@Data
public class TemplateRuleInfoQueryQo extends QueryObject {

    /**
     * 模版ID（精确查询）
     */
    private Long templateId;

    /**
     * 用户ID（精确查询）
     */
    private Long userId;

    /**
     * 资源ID（精确查询）
     */
    private Long resourceId;

    /**
     * （数字员工）DIGITAL_EMPLOYEE  （超级助手）SUPER_ASSISTANT
     */
    private String templateType;
    /**
     * 规则名称（模糊查询）
     */
    private String ruleName;

    /**
     * 规则内容（模糊查询）
     */
    private String ruleContent;

    /**
     * 创建时间起始（时间段查询）
     */
    private Date createTimeStart;

    /**
     * 创建时间结束（时间段查询）
     */
    private Date createTimeEnd;

    /**
     * 更新时间起始（时间段查询）
     */
    private Date updateTimeStart;

    /**
     * 更新时间结束（时间段查询）
     */
    private Date updateTimeEnd;

    /**
     * 记忆模版
     */
    private Boolean isMemoryTemplate = false;
}

