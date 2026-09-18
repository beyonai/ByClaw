package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.Date;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTopic;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTopicMapper;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTopicService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;

class GroupChatTopicServiceTest {
    private final ByaiMessageMapper messages = mock(ByaiMessageMapper.class);
    private final ByaiGroupChatTopicMapper topics = mock(ByaiGroupChatTopicMapper.class);
    private final SessionService sessions = mock(SessionService.class);
    private final GroupChatTopicService service = new GroupChatTopicService(messages, topics, sessions);

    @BeforeEach
    void setUp() {
        when(messages.insert(any(ByaiMessage.class))).thenReturn(1);
    }

    @Test
    void standaloneHasIdentityWithoutTopicRecord() {
        ByaiMessage root = message(1L, null);
        service.persistMessage(root);
        assertThat(root.getTopicId()).isEqualTo(1L);
        verify(messages).insert(root);
        verifyNoInteractions(topics);
    }

    @Test
    void deepReplyBackfillsLegacyChainAndUsesRootRatherThanImmediateParent() {
        when(messages.selectByMessageId(1L)).thenReturn(message(1L, null));
        when(messages.selectByMessageId(2L)).thenReturn(message(2L, 1L));
        ByaiMessage reply = message(3L, 2L);
        service.persistMessage(reply);
        assertThat(reply.getTopicId()).isEqualTo(1L);
        verify(messages).assignGroupTopic(10L, 1L, 1L);
        verify(messages).assignGroupTopic(10L, 2L, 1L);
        ArgumentCaptor<ByaiGroupChatTopic> saved = ArgumentCaptor.forClass(ByaiGroupChatTopic.class);
        verify(topics).upsert(saved.capture());
        assertThat(saved.getValue().getRootMessageId()).isEqualTo(1L);
        assertThat(saved.getValue().getLastMessageId()).isEqualTo(3L);
        var order = inOrder(sessions, messages, topics);
        order.verify(sessions).lockById(10L);
        order.verify(messages).selectByMessageId(2L);
        order.verify(messages).selectByMessageId(1L);
        order.verify(messages).assignGroupTopic(10L, 2L, 1L);
        order.verify(messages).assignGroupTopic(10L, 1L, 1L);
        order.verify(messages).insert(reply);
        order.verify(topics).upsert(any());
    }

    @Test
    void branchesInheritExistingTopicWithoutWalkingTheWholeChain() {
        ByaiMessage parent = message(2L, 1L);
        parent.setTopicId(1L);
        when(messages.selectByMessageId(2L)).thenReturn(parent);
        ByaiMessage left = message(3L, 2L);
        ByaiMessage right = message(4L, 2L);
        service.persistMessage(left);
        service.persistMessage(right);
        assertThat(left.getTopicId()).isEqualTo(right.getTopicId()).isEqualTo(1L);
        verify(messages, never()).selectByMessageId(1L);
    }

    @Test
    void rejectsCrossGroupAndSystemEventReferencesBeforeAnyWrite() {
        ByaiMessage invalid = message(1L, null);
        invalid.setSessionId(11L);
        when(messages.selectByMessageId(1L)).thenReturn(invalid);
        assertThatThrownBy(() -> service.persistMessage(message(2L, 1L))).isInstanceOf(IllegalArgumentException.class);
        invalid.setSessionId(10L);
        invalid.setUsage(5);
        assertThatThrownBy(() -> service.persistMessage(message(2L, 1L))).isInstanceOf(IllegalArgumentException.class);
        verify(messages, never()).insert(any(ByaiMessage.class));
        verifyNoInteractions(topics);
    }

    @Test
    void rejectsMissingAndCyclicLegacyChainsWithoutPartialBackfill() {
        when(messages.selectByMessageId(1L)).thenReturn(message(1L, 2L));
        assertThatThrownBy(() -> service.persistMessage(message(3L, 1L))).isInstanceOf(IllegalArgumentException.class);
        when(messages.selectByMessageId(2L)).thenReturn(message(2L, 1L));
        assertThatThrownBy(() -> service.persistMessage(message(3L, 1L))).isInstanceOf(IllegalArgumentException.class);
        verify(messages, never()).assignGroupTopic(any(), any(), any());
        verify(messages, never()).insert(any(ByaiMessage.class));
        verifyNoInteractions(topics);
    }

    @Test
    void rejectedInsertCannotUpdateTopic() {
        ByaiMessage root = message(1L, null);
        root.setTopicId(1L);
        when(messages.selectByMessageId(1L)).thenReturn(root);
        when(messages.insert(any(ByaiMessage.class))).thenReturn(0);
        assertThatThrownBy(() -> service.persistMessage(message(2L, 1L))).isInstanceOf(IllegalStateException.class);
        verifyNoInteractions(topics);
    }

    static ByaiMessage message(Long id, Long parentId) {
        ByaiMessage message = new ByaiMessage();
        message.setMessageId(id);
        message.setSessionId(10L);
        message.setUsage(1);
        message.setMessageRef(parentId);
        message.setMessageContent("message " + id);
        message.setCreateTime(new Date(1000L + id));
        return message;
    }
}
