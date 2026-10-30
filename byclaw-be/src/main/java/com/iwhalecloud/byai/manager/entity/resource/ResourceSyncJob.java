package com.iwhalecloud.byai.manager.entity.resource;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.util.Date;
import lombok.Data;

@Data
@TableName("byai.byai_resource_sync_job")
public class ResourceSyncJob {
    // Legacy workers only recognize unversioned retry/running states. Keep new work out of their queues.
    public static final String PENDING = "PENDING_V2";
    public static final String RUNNING = "RUNNING_V2";

    public String publicStatus() {
        return status == null ? "PENDING" : status.replaceFirst("_V2$", "");
    }

    public java.util.Map<String, Object> associationResult() {
        var result = resultSummary == null ? new com.alibaba.fastjson.JSONObject()
            : com.alibaba.fastjson.JSON.parseObject(resultSummary);
        var response = new java.util.LinkedHashMap<String, Object>();
        response.put("jobId", String.valueOf(syncJobId));
        response.put("status", publicStatus());
        response.put("effective", "COMPLETED".equals(publicStatus()) && result.getIntValue("skippedUserCount") == 0
            && result.getIntValue("failedEmployeeCount") == 0);
        response.put("result", result);
        return response;
    }

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
