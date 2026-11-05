package com.iwhalecloud.byai.manager.entity.resource;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import java.util.Date;
import lombok.Getter;
import lombok.Setter;

@Getter @Setter
@TableName("byai.resource_publication_target")
public class ResourcePublicationTarget {
    @TableId @JsonSerialize(using = ToStringSerializer.class) private Long targetId;
    @JsonSerialize(using = ToStringSerializer.class) private Long tenantId;
    @JsonSerialize(using = ToStringSerializer.class) private Long requestId;
    @JsonSerialize(using = ToStringSerializer.class) private Long orgId;
    private String orgNameSnapshot;
    private String status;
    private Long revision;
    @JsonSerialize(using = ToStringSerializer.class) private Long reviewerId;
    private String reviewerName;
    private Date reviewedAt;
    private Date appliedAt;
    private String comment;
    private Date createdAt;
}
