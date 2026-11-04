package com.iwhalecloud.byai.manager.entity.resource;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.util.Date;
import lombok.Getter;
import lombok.Setter;

/** Durable server-owned task; requestJson must contain no provider credentials. */
@Getter @Setter
@TableName("byai.knowledge_provision_task")
public class KnowledgeProvisionTask {
    @TableId private Long taskId;
    private Long tenantId;
    private Long resourceId;
    private Long applicantId;
    private String providerId;
    private String idempotencyKey;
    private String requestHash;
    private String requestJson;
    private String externalCode;
    private String status;
    private String error;
    private Date createdAt;
    private Date updatedAt;
}
