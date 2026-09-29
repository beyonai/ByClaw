package com.iwhalecloud.byai.state.domain.groupchat.dto;

import java.util.ArrayList;
import java.util.List;

import lombok.Data;

import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextResponse;

/** 根消息独立返回，回复按时间升序分页，业务 ID 保持字符串。 */
@Data
public class GroupChatTopicMessagesResponse {
    private String topicId;
    private String rootMessageId;
    private GroupChatContextResponse.Message rootMessage;
    private List<GroupChatContextResponse.Message> messages = new ArrayList<>();
    private boolean hasMore;
    private String nextCursor;
}
