package com.iwhalecloud.byai.manager.entity.groupchat;

import com.baomidou.mybatisplus.annotation.*;
import java.time.Instant;
import lombok.Data;

/** Durable forwarding request; provenance and immutable snapshots never depend on source-row lifetime. */
@Data
@TableName("byai_group_chat_forward_request")
public class ByaiGroupChatForwardRequest {
    @TableId(value = "request_id", type = IdType.INPUT)
    private Long requestId;
    private Long enterpriseId;
    private Long actorUserId;
    private String backend;
    private Long sourceSessionId;
    private String clientRequestId;
    private String mode;
    private String requestHash;
    private String state;
    private Integer snapshotVersion;
    /** Immutable public templates, excluding transient source locator candidates. */
    private String frozenJson;
    /** Minimal validated identities/proofs only; request lease fences their first fingerprint freeze. */
    private String sourceManifestJson;
    private Boolean sourcesFrozen;
    private String leaseOwner;
    private Long fencingVersion;
    private Instant leaseUntil;
    private Instant createTime;
    private Instant updateTime;
}
