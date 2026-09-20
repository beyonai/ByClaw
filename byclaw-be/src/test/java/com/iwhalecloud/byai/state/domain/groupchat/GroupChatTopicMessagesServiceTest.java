package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
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
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTopicMapper;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextResponse;
import com.iwhalecloud.byai.state.domain.chat.service.GroupChatContextService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTopicMessagesService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;

class GroupChatTopicMessagesServiceTest {
    private final ByaiGroupChatTopicMapper topics = mock(ByaiGroupChatTopicMapper.class);
    private final ByaiMessageMapper messages = mock(ByaiMessageMapper.class);
    private final GroupChatAuthorizationService auth = mock(GroupChatAuthorizationService.class);
    private final GroupChatContextService context = mock(GroupChatContextService.class);
    private final GroupChatTopicMessagesService service = new GroupChatTopicMessagesService(topics, messages, auth, context);

    @BeforeEach
    void setup() {
        ByaiGroupChatTopic topic = new ByaiGroupChatTopic();
        topic.setRootMessageId(100L);
        when(topics.selectTopic(10L, 100L)).thenReturn(topic);
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
    void pagesRepliesSeparatelyAndPreservesBranchReferences() {
        ByaiMessage root = row(100L, null);
        ByaiMessage first = row(101L, 100L);
        ByaiMessage branch = row(102L, 101L);
        when(messages.selectVisibleGroupMessage(10L, 100L)).thenReturn(root);
        when(messages.selectVisibleGroupMessage(10L, 101L)).thenReturn(first);
        when(messages.selectVisibleGroupMessagesByIds(10L, List.of(100L))).thenReturn(List.of(root));
        when(messages.selectVisibleGroupMessagesByIds(10L, List.of(101L))).thenReturn(List.of(first));
        when(messages.selectTopicMessages(10L, 100L, 100L, null, 2)).thenReturn(List.of(first, branch));
        when(messages.selectTopicMessages(10L, 100L, 100L, 101L, 2))
            .thenReturn(List.of(branch));
        var page = service.list(10L, 100L, 1, null);
        assertThat(page.getRootMessage().getMessageId()).isEqualTo("100");
        assertThat(page.getMessages()).extracting("messageId").containsExactly("101");
        assertThat(page.isHasMore()).isTrue();
        var next = service.list(10L, 100L, 1, page.getNextCursor());
        assertThat(next.getMessages()).extracting("messageId").containsExactly("102");
        assertThat(next.isHasMore()).isFalse();
        verify(context).toMessages(List.of(branch, root), Map.of(101L, first));
        assertThatThrownBy(() -> service.list(10L, 100L, 1, "!"))
            .hasMessage("Invalid topic message cursor");
        when(topics.selectTopic(10L, 200L)).thenReturn(new ByaiGroupChatTopic());
        assertThatThrownBy(() -> service.list(10L, 200L, 1, page.getNextCursor()))
            .hasMessage("Invalid topic message cursor");
    }

    @Test
    void rejectsForgedTimestampAndForeignTopicAnchor() {
        ByaiMessage anchor = row(101L, 100L);
        when(messages.selectVisibleGroupMessage(10L, 101L)).thenReturn(anchor);
        for (String raw : List.of("1:10:100:2000:101", "1:11:100:1000:101", "2:10:100:1000:101")) {
            String cursor = Base64.getUrlEncoder().withoutPadding()
                .encodeToString(raw.getBytes(StandardCharsets.UTF_8));
            assertThatThrownBy(() -> service.list(10L, 100L, 20, cursor))
                .hasMessage("Invalid topic message cursor");
        }
        anchor.setTopicId(200L);
        String cursor = Base64.getUrlEncoder().withoutPadding()
            .encodeToString("1:10:100:1000:101".getBytes(StandardCharsets.UTF_8));
        assertThatThrownBy(() -> service.list(10L, 100L, 20, cursor))
            .hasMessage("Invalid topic message cursor");
    }

    @Test
    void unavailableRootDoesNotHideRepliesAndLimitIsBounded() {
        when(messages.selectTopicMessages(10L, 100L, 100L, null, 51)).thenReturn(List.of(row(101L, 100L)));
        var page = service.list(10L, 100L, 999, null);
        assertThat(page.getRootMessage()).isNull();
        assertThat(page.getRootMessageId()).isEqualTo("100");
        assertThat(page.getMessages()).hasSize(1);
        assertThat(page.getNextCursor()).isNull();
    }

    @Test
    void missingOrForeignTopicCannotReadMessages() {
        assertThatThrownBy(() -> service.list(11L, 100L, 20, null)).hasMessage("Topic not found");
        verifyNoInteractions(messages, context);
    }

    @Test
    void nonMemberCannotReadTopicOrMessages() {
        doThrow(new IllegalArgumentException("not a member")).when(auth).requireCurrentUserMember(10L);
        assertThatThrownBy(() -> service.list(10L, 100L, 20, null)).hasMessage("not a member");
        verifyNoInteractions(messages, context);
    }

    private ByaiMessage row(Long id, Long reference) {
        ByaiMessage message = new ByaiMessage();
        message.setMessageId(id);
        message.setMessageRef(reference);
        message.setTopicId(100L);
        message.setCreateTime(new Date(1000));
        return message;
    }
}
