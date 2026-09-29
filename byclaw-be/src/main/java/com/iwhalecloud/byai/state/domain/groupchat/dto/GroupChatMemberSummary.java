package com.iwhalecloud.byai.state.domain.groupchat.dto;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;

import lombok.Getter;
import lombok.Setter;

/** 群列表头像使用的轻量成员摘要。 */
@Getter
@Setter
public class GroupChatMemberSummary {
    @JsonIgnore
    private Long sessionId;

    private String memObjType;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long memObjId;

    private String memName;

    private String avatar;
}
