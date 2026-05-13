package com.iwhalecloud.byai.manager.entity.aimodel;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;
import java.util.Date;

/**
 * 智能体提示词模板表 对应数据库表：byai_ai_prompt
 *
 * @author system
 * @date 2025-11-01
 */
@Getter
@Setter
@TableName("byai_ai_prompt")
public class AiPrompt {

    /**
     * 主键标识 对应字段：prompt_id (bigint, NOT NULL)
     */
    @TableId
    private Long promptId;

    /**
     * 提示词分组编码 对应字段：prompt_group_code (varchar(50))
     */
    private String promptGroupCode;

    /**
     * 提示词英文属性编码 对应字段：prompt_code (varchar(200))
     */
    private String promptCode;

    /**
     * 提示词中文属性名称 对应字段：prompt_name (varchar(200))
     */
    private String promptName;

    /**
     * 提示词用途说明 对应字段：prompt_desc (varchar(500))
     */
    private String promptDesc;

    /**
     * 提示词字段编码 对应字段：prompt_filed_code (varchar(100))
     */
    private String promptFiledCode;

    /**
     * 中文提示词模板内容 对应字段：prompt_zh_template (text)
     */
    private String promptZhTemplate;

    /**
     * 英文提示词模板内容 对应字段：prompt_en_template (text)
     */
    private String promptEnTemplate;

    private String modelCode;

    /**
     * 创建人ID 对应字段：create_by (bigint)
     */
    private Long createBy;

    /**
     * 创建时间 对应字段：create_time (timestamp)
     */
    private Date createTime;

    /**
     * 更新时间 对应字段：update_time (timestamp)
     */
    private Date updateTime;
}
