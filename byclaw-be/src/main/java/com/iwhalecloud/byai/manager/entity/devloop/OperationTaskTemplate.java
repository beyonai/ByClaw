package com.iwhalecloud.byai.manager.entity.devloop;

import com.alibaba.fastjson.annotation.JSONField;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/** 运营任务模板目录项；结构化模板字段由前端表单填写，数据库只维护可复用的模板元数据。 */
@Getter
@Setter
@TableName("byai_task_template")
public class OperationTaskTemplate {

    @TableId(value = "template_id", type = IdType.INPUT)
    private Long templateId;

    /** collect/knowledge/object_discovery/content/publish/analyze。 */
    private String templateType;

    private String templateName;

    private String description;

    /** 模板默认值和扩展字段，使用 JSON 字符串保存。 */
    private String config;

    private Integer sortNo;

    private Long createBy;

    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date createTime;

    private Long updateBy;

    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date updateTime;

    private String deleteFlag;
}
