package com.iwhalecloud.byai.manager.vo.storage;

import java.util.ArrayList;
import java.util.Date;
import java.util.List;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class UserStorageQuotaAdminVO {

    @JsonSerialize(using = ToStringSerializer.class)
    private Long storageQuotaId;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long userId;

    private String userCode;

    private String bucketName;

    private String storageType;

    private Long baseQuotaBytes;

    private Long addonQuotaBytes;

    private Long totalQuotaBytes;

    private Long usedBytes;

    private Long reservedBytes;

    private String usageStatus;

    private String provisionStatus;

    private String quotaSyncStatus;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date createTime;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date updateTime;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long latestRecycleId;

    private String latestRecycleStatus;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date recycleCreatedTime;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date recycleExpiredTime;

    private Boolean hasGrantHistory;

    private Boolean firstQuotaLimit;

    private Long validRecycleCount;

    private List<StoragePackageSummaryVO> activePackages = new ArrayList<>();
}
