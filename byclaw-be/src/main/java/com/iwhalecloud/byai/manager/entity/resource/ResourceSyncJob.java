package com.iwhalecloud.byai.manager.entity.resource;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.util.Date;
import lombok.Data;

@Data
@TableName("byai.byai_resource_sync_job")
public class ResourceSyncJob {
    @TableId(type = IdType.INPUT)
    private Long syncJobId;
    private Long comAcctId;
    private Long resourceId;
    private Long syncRevision;
    private Long operatorUserId;
    private String authScope;
    private String authRefreshUserIds;
    private String associationMode;
    private Boolean packageChanged;
    private String status;
    private String resultSummary;
    private Integer retryCount;
    private Date nextRetryTime;
    private Date createTime;
    private Date updateTime;
}
