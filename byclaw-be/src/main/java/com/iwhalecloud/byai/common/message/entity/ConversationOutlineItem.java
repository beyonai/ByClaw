package com.iwhalecloud.byai.common.message.entity;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import java.util.Date;
import lombok.Data;

/**
 * Lightweight message projection used by the conversation navigator.
 */
@Data
public class ConversationOutlineItem {

    @JsonSerialize(using = ToStringSerializer.class)
    private Long messageId;

    private String role;

    private Integer usage;

    private String content;

    private String creatorName;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date createTime;

    private Long position;

    private Long totalCount;
}
