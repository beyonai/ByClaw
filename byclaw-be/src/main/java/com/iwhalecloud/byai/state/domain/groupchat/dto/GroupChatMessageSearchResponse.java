package com.iwhalecloud.byai.state.domain.groupchat.dto;

import java.util.ArrayList;
import java.util.List;

import lombok.Data;

import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextResponse;

/** 工作组聊天记录检索结果。 */
@Data
public class GroupChatMessageSearchResponse {
    private List<GroupChatContextResponse.Message> messages = new ArrayList<>();
    private String nextBeforeMessageId;
    private boolean hasMore;
}
