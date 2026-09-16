package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTurn;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTurnMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatExecutionMapper;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatCandidateSessionService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTaskService;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

@ExtendWith(MockitoExtension.class)
class GroupChatTaskAcknowledgementTest {
    @Mock private ByaiGroupChatTaskMapper tasks;
    @Mock private ByaiGroupChatTurnMapper turns;
    @Mock private ByaiGroupChatExecutionMapper executions;
    @Mock private ByaiMessageMapper messages;
    @Mock private SequenceService sequence;
    @Mock private GroupChatCandidateSessionService candidates;
    @Mock private SessionService sessions;
    @Mock private SsResourceService resources;
    @Mock private GroupChatEventPublisher events;
    @InjectMocks private GroupChatTaskService service;

    @AfterEach
    void clearSynchronization() {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    @Test
    void promotesTaskAndPersistsAttachmentFreeAcknowledgementBeforePublishingEvents() {
        ReflectionTestUtils.setField(service, "turnMapper", turns);
        ByaiGroupChatTurn turn = new ByaiGroupChatTurn();
        turn.setExecutionId(8L);
        turn.setAnchorExecutionId(7L);
        turn.setCandidateSessionId(60L);
        turn.setGroupSessionId(1L);
        turn.setSourceMessageId(2L);
        turn.setInitiatorUserId(10L);
        turn.setTargetAgentId(4L);
        when(turns.decideDisposition(eq(8L), eq("TASK"), eq("采集新闻"), eq("正在采集"), any()))
            .thenReturn(1);
        when(sequence.nextVal()).thenReturn(100L);
        TransactionSynchronizationManager.initSynchronization();

        // 任务回执没有附件，仍须完成持久化并注册两个提交后事件。
        ByaiGroupChatTask task = service.promote(turn, "采集新闻", "正在采集");

        assertThat(task.getTaskSessionId()).isEqualTo(60L);
        verify(tasks).insert(task);
        verify(candidates).promote(60L, "采集新闻");
        verify(turns).setAckMessage(8L, 100L);
        ArgumentCaptor<ByaiMessage> saved = ArgumentCaptor.forClass(ByaiMessage.class);
        verify(messages).insert(saved.capture());
        assertThat(saved.getValue().getSessionId()).isEqualTo(1L);
        assertThat(saved.getValue().getMessageContent()).isEqualTo("正在采集");
        JSONObject metadata = JSON.parseObject(saved.getValue().getMetadata());
        assertThat(metadata.getString("kind")).isEqualTo("TASK_ACK");
        assertThat(metadata.getLong("taskId")).isEqualTo(60L);
        verifyNoInteractions(events);

        TransactionSynchronizationManager.getSynchronizations().forEach(TransactionSynchronization::afterCommit);

        ArgumentCaptor<JSONObject> published = ArgumentCaptor.forClass(JSONObject.class);
        verify(events, times(2)).publish(eq(1L), published.capture(), eq(null));
        assertThat(published.getAllValues()).extracting(event -> event.getString("event"))
            .containsExactly("TASK_CREATED", "MESSAGE_CREATED");
        JSONObject acknowledgement = published.getAllValues().get(1);
        assertThat(acknowledgement.getString("kind")).isEqualTo("TASK_ACK");
        assertThat(acknowledgement.getString("taskId")).isEqualTo("60");
        assertThat(acknowledgement.getJSONArray("attachments")).isEmpty();
    }
}
