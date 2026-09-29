package com.iwhalecloud.byai.manager.entity.resource;
/**
 *
 * @author qin.guoquan
 * @date 2026-09-27 22:38:38
 */

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import java.util.Date;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@TableName("byai.digital_employee_publication")
public class DigitalEmployeePublication {
    @TableId
    @JsonSerialize(using = ToStringSerializer.class)
    private Long requestId;
    @JsonSerialize(using = ToStringSerializer.class)
    private Long tenantId;
    @JsonSerialize(using = ToStringSerializer.class)
    private Long sourceId;
    @JsonSerialize(using = ToStringSerializer.class)
    private Long authorId;
    private String authorName;
    private String employeeName;
    @JsonSerialize(using = ToStringSerializer.class)
    private Long officialId;
    private String status;
    private Long revision;
    @JsonIgnore
    private String snapshotJson;
    @JsonIgnore
    private String dependenciesJson;
    private String comment;
    @JsonSerialize(using = ToStringSerializer.class)
    private Long reviewerId;
    private String reviewerName;
    private Date reviewedAt;
    private Date createdAt;
    private Date updatedAt;
    private String publishError;
    @TableField(exist = false)
    private boolean canReview;
}
