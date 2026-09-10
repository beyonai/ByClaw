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
    private String text;
    private List<GroupChatTaskFile> files;
}
