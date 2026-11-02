package com.iwhalecloud.byai.manager.entity.groupchat;

import com.baomidou.mybatisplus.annotation.*;
import java.time.Instant;
import lombok.Data;

/** Durable forwarding target; provenance and immutable snapshots never depend on source-row lifetime. */
@Data
@TableName("byai_group_chat_forward_target")
public class ByaiGroupChatForwardTarget {
    @TableId(value = "target_id", type = IdType.INPUT)
    private Long targetId;
    private Long enterpriseId;
    private Long requestId;
    private Long targetSessionId;
    private String state;
    private String leaseOwner;
    private Long fencingVersion;
    private Instant leaseUntil;
    /** Server-only attempt-owned physical locators and attachment mapping; never a public message field. */
    private String checkpointJson;
    private String messageIdsJson;
    private String errorCode;
    private Boolean retryable;
    private Boolean pendingDelivery;
    private Instant createTime;
    private Instant updateTime;
}
