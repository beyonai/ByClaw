package com.iwhalecloud.byai.manager.entity.groupchat;

import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

@Data
@TableName("byai_workgroup_template_resource")
public class ByaiWorkgroupTemplateResource {
    private Long templateId;
    private Long resourceId;
    private Integer sortOrder;
}
