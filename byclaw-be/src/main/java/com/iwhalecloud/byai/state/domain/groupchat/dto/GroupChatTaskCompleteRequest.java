package com.iwhalecloud.byai.state.domain.groupchat.dto;

import java.util.ArrayList;
import java.util.List;

import jakarta.validation.Valid;
import lombok.Data;

/** 一次性完成任务并发布到群聊的请求。 */
@Data
public class GroupChatTaskCompleteRequest {
    private String text;
    @Valid
    private List<GroupChatTaskFile> files = new ArrayList<>();
}
