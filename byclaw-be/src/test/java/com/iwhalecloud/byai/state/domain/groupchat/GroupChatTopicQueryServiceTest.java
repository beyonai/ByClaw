package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Date;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTopic;
import com.iwhalecloud.byai.manager.entity.groupchat.GroupChatTopicParticipant;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTopicMapper;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextResponse;
import com.iwhalecloud.byai.state.domain.chat.service.GroupChatContextService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTopicQueryService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;

class GroupChatTopicQueryServiceTest {
    private final ByaiGroupChatTopicMapper topics = mock(ByaiGroupChatTopicMapper.class);
    private final ByaiMessageMapper messages = mock(ByaiMessageMapper.class);
    private final GroupChatAuthorizationService authorization = mock(GroupChatAuthorizationService.class);
    private final GroupChatContextService context = mock(GroupChatContextService.class);
    private final GroupChatTopicQueryService service = new GroupChatTopicQueryService(topics, messages, authorization, context);

    @BeforeEach
    void setUp() {
        when(context.toMessages(any(), any())).thenAnswer(call -> {
            List<ByaiMessage> rows = call.getArgument(0);
            return rows.stream().map(row -> {
                GroupChatContextResponse.Message dto = new GroupChatContextResponse.Message();
                dto.setMessageId(String.valueOf(row.getMessageId()));
                return dto;
            }).toList();
        });
    }

    @Test
    void cursorRoundTripsGroupAndAllSortKeysAndFetchesOnlyPageDisplay() {
        when(topics.selectPage(eq(10L), isNull(), isNull(), isNull(), eq(2)))
            .thenReturn(List.of(topic(1L, 3L, 2000), topic(2L, 4L, 1000)));
        ByaiMessage last = GroupChatTopicServiceTest.message(3L, 1L);
        when(messages.selectVisibleGroupMessagesByIds(10L, List.of(1L, 3L))).thenReturn(List.of(last));
        when(messages.selectVisibleGroupMessagesByIds(10L, List.of(1L))).thenReturn(List.of());
        var result = service.list(10L, 1, null);
        assertThat(result.isHasMore()).isTrue();
        assertThat(result.getItems()).hasSize(1);
        assertThat(result.getItems().get(0).getTopicId()).isEqualTo("1");
        assertThat(result.getItems().get(0).getRootMessage()).isNull();
        assertThat(result.getItems().get(0).getLastMessage().getMessageId()).isEqualTo("3");
        verify(context).toMessages(List.of(last), Map.of());
        service.list(10L, 1, result.getNextCursor());
        verify(topics).selectPage(10L, new Date(2000), 3L, 1L, 2);
        assertThatThrownBy(() -> service.list(11L, 1, result.getNextCursor()))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void missingDisplayDoesNotRemoveTopicOrRecomputeStoredActivity() {
        when(topics.selectPage(eq(10L), isNull(), isNull(), isNull(), eq(21)))
            .thenReturn(List.of(topic(1L, 3L, 2000)));
        var result = service.list(10L, null, null);
        assertThat(result.getItems()).hasSize(1);
        assertThat(result.getItems().get(0).getRootMessage()).isNull();
        assertThat(result.getItems().get(0).getLastMessage()).isNull();
        assertThat(result.getItems().get(0).getLastMessageId()).isEqualTo("3");
        assertThat(result.getItems().get(0).getLastActivityAt()).isEqualTo(2000L);
        assertThat(result.isHasMore()).isFalse();
        assertThat(result.getNextCursor()).isNull();
    }

    @Test
    void returnsAllTopicParticipantsInFirstMessageOrder() {
        when(topics.selectPage(eq(10L), isNull(), isNull(), isNull(), eq(21)))
            .thenReturn(List.of(topic(1L, 3L, 2000)));
        when(messages.selectGroupTopicParticipants(10L, List.of(1L))).thenReturn(List.of(
            participant(1L, "USER", 7L, "小林", 1L),
            participant(1L, "AGENT", 9L, "分析助手", 2L)));

        var result = service.list(10L, null, null);

        assertThat(result.getItems().get(0).getParticipants())
            .extracting("memberType", "memberId", "displayName")
            .containsExactly(
                org.assertj.core.groups.Tuple.tuple("USER", "7", "小林"),
                org.assertj.core.groups.Tuple.tuple("AGENT", "9", "分析助手"));
    }

    @Test
    void boundsPageSizeAndRejectsMalformedCursor() {
        service.list(10L, 5000, null);
        verify(topics).selectPage(10L, null, null, null, 51);
        service.list(10L, 0, null);
        verify(topics).selectPage(10L, null, null, null, 2);
        for (String cursor : List.of("!", "a".repeat(257), encode("2:10:1000:3:1"), encode("1:10:-1:3:1"))) {
            assertThatThrownBy(() -> service.list(10L, 20, cursor)).isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Test
    void nonMemberCannotQueryTopicsOrMessages() {
        doThrow(new IllegalArgumentException("not found")).when(authorization).requireCurrentUserMember(10L);
        assertThatThrownBy(() -> service.list(10L, 20, null)).hasMessage("not found");
        verifyNoInteractions(topics, messages);
    }

    private String encode(String input) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(input.getBytes(StandardCharsets.UTF_8));
    }

    private ByaiGroupChatTopic topic(Long id, Long lastId, long time) {
        ByaiGroupChatTopic topic = new ByaiGroupChatTopic();
        topic.setTopicId(id); topic.setRootMessageId(id); topic.setGroupSessionId(10L);
        topic.setLastMessageId(lastId); topic.setLastActivityAt(new Date(time));
        return topic;
    }

    private GroupChatTopicParticipant participant(Long topicId, String type, Long id, String name,
        Long firstMessageId) {
        GroupChatTopicParticipant participant = new GroupChatTopicParticipant();
        participant.setTopicId(topicId);
        participant.setMemberType(type);
        participant.setMemberId(id);
        participant.setDisplayName(name);
        participant.setFirstMessageId(firstMessageId);
        return participant;
    }
}
