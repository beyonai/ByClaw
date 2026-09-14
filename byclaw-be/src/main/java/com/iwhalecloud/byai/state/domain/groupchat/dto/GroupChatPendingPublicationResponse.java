package com.iwhalecloud.byai.state.domain.groupchat.dto;

import java.util.Date;
import java.util.List;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Data;

/** 私有发布卡片快照，不向群成员暴露工作区路径。 */
@Data
public class GroupChatPendingPublicationResponse {
    @JsonSerialize(using = ToStringSerializer.class)
    private Long taskId;
    @JsonSerialize(using = ToStringSerializer.class)
    private Long pendingPublicationId;
    private String text;
    private List<String> sourcePaths;
    private Date createTime;
}
