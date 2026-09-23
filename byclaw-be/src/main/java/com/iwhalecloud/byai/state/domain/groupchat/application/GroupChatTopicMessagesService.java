package com.iwhalecloud.byai.state.domain.groupchat.application;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTopic;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTopicMapper;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextResponse;
import com.iwhalecloud.byai.state.domain.chat.service.GroupChatContextService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatTopicMessagesResponse;

/** 话题详情只读取当前群公开消息，复用历史消息的引用和资源投影。 */
@Service
public class GroupChatTopicMessagesService {
    private final ByaiGroupChatTopicMapper topics;
    private final ByaiMessageMapper messages;
    private final GroupChatAuthorizationService authorization;
    private final GroupChatContextService context;

    public GroupChatTopicMessagesService(ByaiGroupChatTopicMapper topics, ByaiMessageMapper messages,
        GroupChatAuthorizationService authorization, GroupChatContextService context) {
        this.topics = topics;
        this.messages = messages;
        this.authorization = authorization;
        this.context = context;
    }

    public GroupChatTopicMessagesResponse list(Long sessionId, Long topicId, Integer requestedLimit, String cursor) {
        authorization.requireCurrentUserMember(sessionId);
        ByaiGroupChatTopic topic = topics.selectTopic(sessionId, topicId);
        if (topic == null) throw new IllegalArgumentException("Topic not found");
        ByaiMessage anchor = decodeCursor(sessionId, topicId, cursor);
        int limit = requestedLimit == null ? 20 : Math.max(1, Math.min(50, requestedLimit));
        List<ByaiMessage> rows = messages.selectTopicMessages(sessionId, topicId, topic.getRootMessageId(),
            anchor == null ? null : anchor.getMessageId(), limit + 1);
        List<ByaiMessage> page = rows.subList(0, Math.min(rows.size(), limit));
        ByaiMessage root = messages.selectVisibleGroupMessage(sessionId, topic.getRootMessageId());
        List<ByaiMessage> displayRows = new ArrayList<>(page);
        if (root != null) displayRows.add(root);
        List<Long> referenceIds = displayRows.stream().map(ByaiMessage::getMessageRef).filter(Objects::nonNull)
            .distinct().toList();
        Map<Long, ByaiMessage> references = referenceIds.isEmpty() ? Map.of()
            : messages.selectVisibleGroupMessagesByIds(sessionId, referenceIds).stream()
                .collect(Collectors.toMap(ByaiMessage::getMessageId, Function.identity()));
        Map<String, GroupChatContextResponse.Message> display = context.toMessages(displayRows, references).stream()
            .collect(Collectors.toMap(GroupChatContextResponse.Message::getMessageId, Function.identity()));
        GroupChatTopicMessagesResponse response = new GroupChatTopicMessagesResponse();
        response.setTopicId(String.valueOf(topicId));
        response.setRootMessageId(String.valueOf(topic.getRootMessageId()));
        response.setRootMessage(display.get(response.getRootMessageId()));
        response.setMessages(page.stream().map(row -> display.get(String.valueOf(row.getMessageId()))).toList());
        response.setHasMore(rows.size() > limit);
        if (response.isHasMore()) {
            ByaiMessage last = page.get(page.size() - 1);
            String value = "1:" + sessionId + ":" + topicId + ":" + last.getCreateTime().getTime()
                + ":" + last.getMessageId();
            response.setNextCursor(Base64.getUrlEncoder().withoutPadding()
                .encodeToString(value.getBytes(StandardCharsets.UTF_8)));
        }
        return response;
    }

    private ByaiMessage decodeCursor(Long sessionId, Long topicId, String cursor) {
        if (cursor == null || cursor.isBlank()) return null;
        try {
            if (cursor.length() > 256) throw new IllegalArgumentException();
            String[] parts = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8).split(":", -1);
            if (parts.length != 5 || !"1".equals(parts[0]) || !sessionId.equals(Long.valueOf(parts[1]))
                || !topicId.equals(Long.valueOf(parts[2]))) throw new IllegalArgumentException();
            long time = Long.parseLong(parts[3]);
            long messageId = Long.parseLong(parts[4]);
            if (time < 0 || time > 253402300799999L || messageId <= 0) throw new IllegalArgumentException();
            ByaiMessage anchor = messages.selectVisibleGroupMessage(sessionId, messageId);
            if (anchor == null || !topicId.equals(anchor.getTopicId()) || anchor.getCreateTime() == null
                || anchor.getCreateTime().getTime() != time) throw new IllegalArgumentException();
            // SQL reads the boundary timestamp directly so Date conversion cannot lose database precision.
            return anchor;
        }
        catch (IllegalArgumentException exception) {
            throw new IllegalArgumentException("Invalid topic message cursor");
        }
    }
}
