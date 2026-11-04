package com.iwhalecloud.byai.manager.entity.auth;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.annotation.JsonIgnore;
import lombok.Data;

@Data
@TableName("byai_authorization_task")
public class AuthorizationTask {
    @TableId(type = IdType.INPUT) private String taskId;
    @JsonIgnore @com.alibaba.fastjson.annotation.JSONField(serialize = false) private Long enterpriseId;
    @JsonIgnore @com.alibaba.fastjson.annotation.JSONField(serialize = false) private Long operatorId;
    private Long resourceId;
    private String operation;
    private String requestId;
    @JsonIgnore @com.alibaba.fastjson.annotation.JSONField(serialize = false) private String requestHash;
    @JsonIgnore @com.alibaba.fastjson.annotation.JSONField(serialize = false) private String payload;
    private String status;
    private String phase;
    private Integer progress;
    private Integer completedUsers;
    private Integer totalUsers;
    private Integer dataApplied;
    private String message;
    private Integer attempts;
    private Long createdAt;
    private Long updatedAt;
    @JsonIgnore @com.alibaba.fastjson.annotation.JSONField(serialize = false) private Long retryAt;
    @JsonIgnore @com.alibaba.fastjson.annotation.JSONField(serialize = false) private Long leaseUntil;
    @JsonIgnore @com.alibaba.fastjson.annotation.JSONField(serialize = false) private String leaseToken;
    @JsonIgnore @com.alibaba.fastjson.annotation.JSONField(serialize = false) private String activeResource;
    @JsonIgnore @com.alibaba.fastjson.annotation.JSONField(serialize = false) private String workerSlot;
    @JsonIgnore @com.alibaba.fastjson.annotation.JSONField(serialize = false) private String cachePlan;
}
