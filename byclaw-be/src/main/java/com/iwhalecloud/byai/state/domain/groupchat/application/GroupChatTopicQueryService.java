package com.iwhalecloud.byai.state.domain.groupchat.application;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTopic;
import com.iwhalecloud.byai.manager.entity.groupchat.GroupChatTopicParticipant;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTopicMapper;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextResponse;
import com.iwhalecloud.byai.state.domain.chat.service.GroupChatContextService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatTopicListResponse;

/** 先按活动索引分页，再批量加载有权展示的消息。 */
@Service
public class GroupChatTopicQueryService {
    private final ByaiGroupChatTopicMapper topicMapper;
    private final ByaiMessageMapper messageMapper;
    private final GroupChatAuthorizationService authorization;
    private final GroupChatContextService contextService;

    public GroupChatTopicQueryService(ByaiGroupChatTopicMapper topicMapper, ByaiMessageMapper messageMapper,
        GroupChatAuthorizationService authorization, GroupChatContextService contextService) {
        this.topicMapper = topicMapper;
        this.messageMapper = messageMapper;
        this.authorization = authorization;
        this.contextService = contextService;
    }

    public GroupChatTopicListResponse list(Long sessionId, Integer requestedLimit, String cursor) {
        authorization.requireCurrentUserMember(sessionId);
        int limit = requestedLimit == null ? 20 : Math.max(1, Math.min(50, requestedLimit));
        Cursor before = decodeCursor(sessionId, cursor);
        List<ByaiGroupChatTopic> rows = topicMapper.selectPage(sessionId, before == null ? null : before.time(),
            before == null ? null : before.messageId(), before == null ? null : before.topicId(), limit + 1);
        GroupChatTopicListResponse response = new GroupChatTopicListResponse();
        response.setHasMore(rows.size() > limit);
        List<ByaiGroupChatTopic> page = rows.subList(0, Math.min(rows.size(), limit));
        Set<Long> ids = new LinkedHashSet<>();
        page.forEach(topic -> { ids.add(topic.getRootMessageId()); ids.add(topic.getLastMessageId()); });
        List<ByaiMessage> messages = ids.isEmpty() ? List.of()
            : messageMapper.selectVisibleGroupMessagesByIds(sessionId, new ArrayList<>(ids));
        List<Long> referenceIds = messages.stream().map(ByaiMessage::getMessageRef).filter(Objects::nonNull)
            .distinct().toList();
        Map<Long, ByaiMessage> references = referenceIds.isEmpty() ? Map.of()
            : messageMapper.selectVisibleGroupMessagesByIds(sessionId, referenceIds).stream()
                .collect(Collectors.toMap(ByaiMessage::getMessageId, Function.identity()));
        Map<String, GroupChatContextResponse.Message> display = contextService.toMessages(messages, references).stream()
            .collect(Collectors.toMap(GroupChatContextResponse.Message::getMessageId, Function.identity()));
        Map<Long, List<GroupChatTopicParticipant>> participants = page.isEmpty() ? Map.of()
            : messageMapper.selectGroupTopicParticipants(sessionId,
                page.stream().map(ByaiGroupChatTopic::getTopicId).toList()).stream()
                .collect(Collectors.groupingBy(GroupChatTopicParticipant::getTopicId,
                    Collectors.toList()));
        for (ByaiGroupChatTopic topic : page) {
            GroupChatTopicListResponse.Item item = new GroupChatTopicListResponse.Item();
            item.setTopicId(String.valueOf(topic.getTopicId()));
            item.setRootMessageId(String.valueOf(topic.getRootMessageId()));
            item.setLastMessageId(String.valueOf(topic.getLastMessageId()));
            item.setLastActivityAt(topic.getLastActivityAt().getTime());
            item.setRootMessage(display.get(item.getRootMessageId()));
            item.setLastMessage(display.get(item.getLastMessageId()));
            participants.getOrDefault(topic.getTopicId(), List.of()).forEach(row -> {
                GroupChatTopicListResponse.Participant participant = new GroupChatTopicListResponse.Participant();
                participant.setMemberType(row.getMemberType());
                participant.setMemberId(String.valueOf(row.getMemberId()));
                participant.setDisplayName(row.getDisplayName() == null ? "" : row.getDisplayName());
                item.getParticipants().add(participant);
            });
            response.getItems().add(item);
        }
        if (response.isHasMore()) {
            ByaiGroupChatTopic last = page.get(page.size() - 1);
            String value = "1:" + sessionId + ":" + last.getLastActivityAt().getTime() + ":"
                + last.getLastMessageId() + ":" + last.getTopicId();
            response.setNextCursor(Base64.getUrlEncoder().withoutPadding()
                .encodeToString(value.getBytes(StandardCharsets.UTF_8)));
        }
        return response;
    }

    private Cursor decodeCursor(Long sessionId, String cursor) {
        if (cursor == null || cursor.isBlank()) return null;
        try {
            if (cursor.length() > 256) throw new IllegalArgumentException();
            String[] parts = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8).split(":", -1);
            if (parts.length != 5 || !"1".equals(parts[0]) || !sessionId.equals(Long.valueOf(parts[1]))) {
                throw new IllegalArgumentException();
            }
            long time = Long.parseLong(parts[2]);
            long messageId = Long.parseLong(parts[3]);
            long topicId = Long.parseLong(parts[4]);
            if (time < 0 || time > 253402300799999L || messageId <= 0 || topicId <= 0) {
                throw new IllegalArgumentException();
            }
            return new Cursor(new Date(time), messageId, topicId);
        }
        catch (IllegalArgumentException exception) {
            throw new IllegalArgumentException("Invalid topic cursor");
        }
    }

    private record Cursor(Date time, Long messageId, Long topicId) {}
}
