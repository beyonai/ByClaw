package com.iwhalecloud.byai.state.domain.groupchat.dto;

import java.util.ArrayList;
import java.util.List;

import lombok.Data;

import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextResponse;

/** 话题页不包含精确总数，所有业务 ID 使用字符串。 */
@Data
public class GroupChatTopicListResponse {
    private List<Item> items = new ArrayList<>();
    private boolean hasMore;
    private String nextCursor;

    @Data
    public static class Item {
        private String topicId;
        private String rootMessageId;
        private String lastMessageId;
        private Long lastActivityAt;
        private GroupChatContextResponse.Message rootMessage;
        private GroupChatContextResponse.Message lastMessage;
        private List<Participant> participants = new ArrayList<>();
    }

    /** 参与者身份由类型和 ID 唯一确定，名称是消息写入时的展示快照。 */
    @Data
    public static class Participant {
        private String memberType;
        private String memberId;
        private String displayName;
    }
}
