package com.iwhalecloud.byai.state.domain.groupchat.dto;

import java.util.List;

import lombok.Data;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;

@Data
public class GroupChatTaskPublicationResponse {
    @JsonSerialize(using = ToStringSerializer.class)
    private Long taskId;
    @JsonSerialize(using = ToStringSerializer.class)
    private Long messageId;
    @JsonSerialize(using = ToStringSerializer.class)
    private Long pendingPublicationId;
    /** 绑定真人待办时返回提交版本，不产生新的群 messageId。 */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long humanTaskId;
    @JsonSerialize(using = ToStringSerializer.class)
    private Long submissionId;
    private Integer version;
    private String status;
    private String text;
    private List<GroupChatTaskFile> files;
}
