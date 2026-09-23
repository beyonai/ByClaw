package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.sql.Connection;
import java.util.Date;
import java.util.List;

import javax.sql.DataSource;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;
import org.springframework.web.server.ResponseStatusException;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatMessageAck;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatMentionMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatMessageAckMapper;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatMessageAckService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;

/** “收到”只写确认记录，并在事务提交后复用群事件广播。 */
class GroupChatMessageAckTest {
    private final ByaiGroupChatMessageAckMapper acknowledgements = mock(ByaiGroupChatMessageAckMapper.class);
    private final ByaiGroupChatMentionMapper mentions = mock(ByaiGroupChatMentionMapper.class);
    private final ByaiMessageMapper messages = mock(ByaiMessageMapper.class);
    private final GroupChatAuthorizationService auth = mock(GroupChatAuthorizationService.class);
    private final GroupChatEventPublisher events = mock(GroupChatEventPublisher.class);
    private final Connection connection = mock(Connection.class);
    private GroupChatMessageAckService service;
    private ByaiMessage message;

    @BeforeEach
    void setUp() throws Exception {
        LoginInfo login = new LoginInfo();
        login.setUserId(2L);
        login.setUserName("周伯通");
        CurrentUserHolder.setLoginInfo(login);
        ByaiSessionMember member = new ByaiSessionMember();
        member.setMemObjType("USER");
        member.setMemObjId(2L);
        member.setMemName("10000029");
        when(auth.requireCurrentUserMember(7L)).thenReturn(member);
        message = new ByaiMessage();
        message.setSessionId(7L);
        message.setMessageId(20L);
        message.setCreatorId(1L);
        when(messages.selectByMessageId(20L)).thenReturn(message);
        when(mentions.existsUserMention(7L, 20L, 2L)).thenReturn(true);
        when(acknowledgements.insertIfAbsent(any())).thenReturn(1);
        when(acknowledgements.selectByMessageIds(7L, List.of(20L))).thenAnswer(call -> {
            ByaiGroupChatMessageAck ack = new ByaiGroupChatMessageAck();
            ack.setSessionId(7L);
            ack.setMessageId(20L);
            ack.setUserId(2L);
            ack.setUserName("10000029");
            ack.setAcknowledgedAt(new Date(10));
            return List.of(ack);
        });
        DataSource dataSource = mock(DataSource.class);
        when(dataSource.getConnection()).thenReturn(connection);
        when(connection.getAutoCommit()).thenReturn(true);
        doAnswer(call -> { verifyNoInteractions(events); return null; }).when(connection).commit();
        TransactionInterceptor interceptor = new TransactionInterceptor();
        interceptor.setTransactionManager(new DataSourceTransactionManager(dataSource));
        interceptor.setTransactionAttributeSource(new AnnotationTransactionAttributeSource());
        ProxyFactory factory = new ProxyFactory(
            new GroupChatMessageAckService(acknowledgements, mentions, messages, auth, events));
        factory.setProxyTargetClass(true);
        factory.addAdvice(interceptor);
        service = (GroupChatMessageAckService) factory.getProxy();
    }

    @AfterEach
    void clear() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void mentionedUserUpdatesOriginalMessageAndBroadcastsAfterCommit() throws Exception {
        JSONObject result = service.acknowledge(7L, 20L);
        assertThat(result.getString("event")).isEqualTo("MESSAGE_ACK_UPDATED");
        assertThat(result.getJSONArray("acknowledgements")).hasSize(1);
        assertThat(result.getJSONArray("acknowledgements").getJSONObject(0).getString("messageId")).isEqualTo("20");
        verify(connection).commit();
        ArgumentCaptor<JSONObject> event = ArgumentCaptor.forClass(JSONObject.class);
        verify(events).publish(eq(7L), event.capture(), isNull());
        assertThat(event.getValue().getString("messageId")).isEqualTo("20");
        assertThat(event.getValue().toJSONString()).contains("周伯通").doesNotContain("10000029");
        ArgumentCaptor<ByaiGroupChatMessageAck> inserted = ArgumentCaptor.forClass(ByaiGroupChatMessageAck.class);
        verify(acknowledgements).insertIfAbsent(inserted.capture());
        assertThat(inserted.getValue().getUserName()).isEqualTo("周伯通");
        verify(messages, never()).insert(any(ByaiMessage.class));
        var order = inOrder(acknowledgements, events);
        order.verify(acknowledgements).insertIfAbsent(any());
        order.verify(acknowledgements).selectByMessageIds(7L, List.of(20L));
        order.verify(events).publish(eq(7L), any(), isNull());
    }

    @Test
    void acknowledgedUserCanUndoWithoutCreatingANewMessage() {
        ByaiGroupChatMessageAck otherAck = new ByaiGroupChatMessageAck();
        otherAck.setSessionId(7L);
        otherAck.setMessageId(20L);
        otherAck.setUserId(3L);
        otherAck.setUserName("用户C");
        otherAck.setAcknowledgedAt(new Date(9));
        when(acknowledgements.selectByMessageIds(7L, List.of(20L))).thenReturn(List.of(otherAck));

        JSONObject result = service.unacknowledge(7L, 20L);

        assertThat(result.getString("event")).isEqualTo("MESSAGE_ACK_UPDATED");
        assertThat(result.getJSONArray("acknowledgements")).hasSize(1);
        assertThat(result.getJSONArray("acknowledgements").getJSONObject(0).getString("userId")).isEqualTo("3");
        verify(acknowledgements).deleteByMessageAndUser(7L, 20L, 2L);
        verify(messages, never()).insert(any(ByaiMessage.class));
        verify(events).publish(eq(7L), any(), isNull());
    }

    @Test
    void unmentionedUserCannotAcknowledge() {
        when(mentions.existsUserMention(7L, 20L, 2L)).thenReturn(false);
        assertThatThrownBy(() -> service.acknowledge(7L, 20L))
            .isInstanceOf(ResponseStatusException.class)
            .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
                .isEqualTo(HttpStatus.FORBIDDEN));
        verify(acknowledgements, never()).insertIfAbsent(any());
        verifyNoInteractions(events);
    }

    @Test
    void senderAndRecalledMessageCannotAcknowledge() {
        message.setCreatorId(2L);
        assertThatThrownBy(() -> service.acknowledge(7L, 20L)).isInstanceOf(ResponseStatusException.class);
        message.setCreatorId(1L);
        message.setRecalledAt(new Date());
        assertThatThrownBy(() -> service.acknowledge(7L, 20L)).isInstanceOf(IllegalArgumentException.class);
        verify(acknowledgements, never()).insertIfAbsent(any());
        verifyNoInteractions(events);
    }
}
