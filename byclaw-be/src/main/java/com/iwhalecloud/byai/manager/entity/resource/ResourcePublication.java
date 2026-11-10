package com.iwhalecloud.byai.manager.entity.resource;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import java.util.Date;
import lombok.Getter;
import lombok.Setter;

@Getter @Setter
@TableName("byai.resource_publication")
public class ResourcePublication {
    @TableId @JsonSerialize(using = ToStringSerializer.class) private Long requestId;
    @JsonSerialize(using = ToStringSerializer.class) private Long tenantId;
    @JsonSerialize(using = ToStringSerializer.class) private Long resourceId;
    @JsonSerialize(using = ToStringSerializer.class) private Long sourceResourceId;
    private String requestSource;
    private String operation;
    @JsonSerialize(using = ToStringSerializer.class) private Long applicantId;
    private String applicantName;
    private String reviewSnapshotJson;
    @JsonIgnore private String resourceFingerprint;
    private String beforeScopeJson;
    private String requestedScopeJson;
    private String status;
    private Long revision;
    private Long baseScopeRevision;
    @JsonIgnore private String idempotencyKey;
    private String comment;
    private Date createdAt;
    private Date submittedAt;
    private Date closedAt;
    private Date updatedAt;
}
