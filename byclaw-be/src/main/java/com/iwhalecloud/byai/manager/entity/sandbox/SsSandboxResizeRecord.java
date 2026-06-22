package com.iwhalecloud.byai.manager.entity.sandbox;

import java.util.Date;

import com.alibaba.fastjson.annotation.JSONField;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

@Setter
@Getter
@TableName("ss_sandbox_resize_record")
public class SsSandboxResizeRecord {

    @TableId(value = "id", type = IdType.INPUT)
    private Long id;

    private Long sandboxRecordId;

    private String sandboxId;

    private String userCode;

    private String serviceType;

    private String fromProfileKey;

    private String toProfileKey;

    private String fromResourceRequests;

    private String fromResourceLimits;

    private String toResourceRequests;

    private String toResourceLimits;

    private String triggerSource;

    private String reasonCode;

    private String reasonDetail;

    private String resizeType;

    private String idempotencyKey;

    private String status;

    private Integer success;

    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date startedAt;

    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date finishedAt;

    private Long durationMs;

    private String opensandboxRequestId;

    private String opensandboxResponse;

    private String errorMessage;

    private String skipReason;

    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date createTime;

    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date updateTime;
}
