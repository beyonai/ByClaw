package com.iwhalecloud.byai.manager.entity.storage;

import java.util.Date;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@TableName("po_user_storage_quota")
public class UserStorageQuota {

    @TableId(value = "storage_quota_id", type = IdType.INPUT)
    private Long storageQuotaId;

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

    private Date lastScanTime;

    private Date lastWarningTime;

    private String lastWarningStatus;

    private Long version;

    private String lastError;

    private Long createBy;

    private Date createTime;

    private Long updateBy;

    private Date updateTime;

    private String deleteFlag;
}
