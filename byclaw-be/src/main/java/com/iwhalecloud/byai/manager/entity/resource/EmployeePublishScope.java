package com.iwhalecloud.byai.manager.entity.resource;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.util.Date;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@TableName("byai.digital_employee_publish_scope")
public class EmployeePublishScope {
    @TableId
    private Long scopeId;
    private Long tenantId;
    private Long resourceId;
    private Long orgId;
    private Long requestId;
    private Date createdAt;
}
