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
    public static final String PENDING = "PENDING_V3";
    public static final String RUNNING = "RUNNING_V3";

    public String publicStatus() {
        return status == null ? "PENDING" : status.replaceFirst("_V[23]$", "");
    }

    public java.util.Map<String, Object> associationResult() {
        var result = resultSummary == null ? new com.alibaba.fastjson.JSONObject()
            : com.alibaba.fastjson.JSON.parseObject(resultSummary);
        var response = new java.util.LinkedHashMap<String, Object>();
        response.put("jobId", String.valueOf(syncJobId));
        response.put("status", publicStatus());
        response.put("effective", "COMPLETED".equals(publicStatus()) && result.getIntValue("skippedUserCount") == 0
            && result.getIntValue("failedEmployeeCount") == 0);
        // Internal checkpoints contain authorization scopes and must never be exposed to list readers.
        var visible = new java.util.LinkedHashMap<String, Object>();
        for (String key : java.util.List.of("phase", "message", "totalUsers", "completedUsers",
            "employeeCount", "completedEmployeeCount", "failedEmployeeCount", "skippedUserCount",
            "skipReasons", "authorizationApplied", "authorizationEffective")) {
            if (result.containsKey(key)) visible.put(key, result.get(key));
        }
        response.put("result", visible);
        response.put("resourceId", String.valueOf(resourceId));
        response.put("syncRevision", String.valueOf(syncRevision));
        response.put("retryCount", retryCount);
        response.put("retryLimit", retryLimit);
        response.put("retryable", java.util.List.of("FAILED", "PARTIAL").contains(publicStatus()));
        response.put("updatedAt", updateTime == null ? null : updateTime.getTime());
        response.put("query", java.util.Map.of("method", "POST", "path", "/byaiService/tool/queryResourceSyncJob",
            "body", java.util.Map.of("jobId", String.valueOf(syncJobId)), "pollAfterMs", 3000));
        return response;
    }

    @TableId(type = IdType.INPUT)
    private Long syncJobId;
    private Long comAcctId;
    private Long resourceId;
    private Long syncRevision;
    private Long operatorUserId;
    private String requestId;
    private String requestHash;
    private String authorizationIntent;
    private String authScope;
    private String authRefreshUserIds;
    private String associationMode;
    private Boolean packageChanged;
    private String status;
    private String resultSummary;
    private Integer retryCount;
    private Integer retryLimit = 8;
    private Date nextRetryTime;
    private Date createTime;
    private Date updateTime;
}
