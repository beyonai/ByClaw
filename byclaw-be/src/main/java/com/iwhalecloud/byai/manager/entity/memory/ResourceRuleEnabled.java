package com.iwhalecloud.byai.manager.entity.memory;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;
import java.util.Date;

/**
 * 资源规则启用状态表
 * 
 * @author system &#064;date 2025-01-XX
 */
@Getter
@Setter
@TableName("resource_rule_enabled")
public class ResourceRuleEnabled {

    /**
     * 资源模版关联ID（主键）
     */
    @TableId(value = "resource_template_id", type = IdType.INPUT)
    private Long resourceTemplateId;

    /**
     * 模版ID
     */
    private Long templateId;

    /**
     * 资源ID（数字员工ID，超级助手固定为-1）
     */
    private Long resourceId;

    /**
     * 用户ID
     */
    private Long userId;

    /**
     * 资源启用状态（0-关闭，1-开启）
     */
    private Integer resourceEnabled;

    /**
     * 更新人
     */
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
