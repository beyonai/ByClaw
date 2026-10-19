package com.iwhalecloud.byai.manager.entity.groupchat;

import com.baomidou.mybatisplus.annotation.*;
import java.time.Instant;
import lombok.Data;

/** Durable forwarding item; provenance and immutable snapshots never depend on source-row lifetime. */
@Data
@TableName("byai_group_chat_forward_item")
public class ByaiGroupChatForwardItem {
    @TableId(value = "item_id", type = IdType.INPUT)
    private Long itemId;
    private Long enterpriseId;
    private Long requestId;
    private Long targetId;
    private Integer ordinal;
    /** Selected outer message/card groups items independently of historical inner-message provenance. */
    private Long selectedMessageId;
    private Boolean selectedMergedCard;
    private Long sourceMessageId;
    private String content;
    private String speakerJson;
    private Instant sourceCreatedAt;
    private String referencesJson;
    private String attachmentsJson;
    private Long boundMessageId;
    private Instant createTime;
}
