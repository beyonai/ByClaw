package com.iwhalecloud.byai.manager.vo.storage;

import java.util.Date;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class UserStorageDowngradeAdminVO {

    @JsonSerialize(using = ToStringSerializer.class)
    private Long downgradeId;

    private String requestId;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long userId;

    private String userCode;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long grantId;

    private String grantIds;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long packageId;

    private String packageCode;

    private String packageName;

    private String packageNames;

    private Long changeBytes;

    private String requestSource;

    private String requestType;

    private String downgradeStatus;

    private String grantSource;

    private Long beforeQuotaBytes;

    private Long targetQuotaBytes;

    private Long usedBytesSnapshot;

    private Long reservedBytesSnapshot;

    private Long overageBytes;

    private String reason;

    private String reviewRemark;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date graceDeadline;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long relatedRecycleId;

    private String requestedByCode;

    private String reviewedByCode;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date requestedTime;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date reviewedTime;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date completedTime;

    private String errorMessage;
}
