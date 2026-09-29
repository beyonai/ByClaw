package com.iwhalecloud.byai.manager.entity.groupchat;

import java.util.Date;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Data;

@Data
@TableName("byai_workgroup_template")
public class ByaiWorkgroupTemplate {
    @TableId(value = "template_id", type = IdType.INPUT)
    @JsonSerialize(using = ToStringSerializer.class)
    private Long templateId;
    private String templateName;
    private Long catalogId;
    private String summary;
    private String defaultGroupName;
    private String defaultGoal;
    private String icon;
    private Integer sortOrder;
    private String status;
    private Long version;
    private Long createBy;
    private Long updateBy;
    private Date createTime;
    private Date updateTime;
}
