package com.iwhalecloud.byai.manager.entity.resource;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.util.Date;
import lombok.Data;

/** 生效操作及提交后的运行态同步结果；失败可重试，历史版本不覆盖。 */
@Data
@TableName("byai.ss_resource_version_activation")
public class EmployeeVersionActivation {
    @TableId
    private Long activationId;
    private Long tenantId;
    private Long resourceId;
    private Long fromVersionId;
    private Long toVersionId;
    private Long expectedRevision;
    private Long operatorId;
    private String requestId;
    private String reason;
    private String status;
    @com.baomidou.mybatisplus.annotation.TableField(updateStrategy = com.baomidou.mybatisplus.annotation.FieldStrategy.ALWAYS)
    private String errorMessage;
    private Integer retryCount;
    private Date createdAt;
    private Date completedAt;
}
