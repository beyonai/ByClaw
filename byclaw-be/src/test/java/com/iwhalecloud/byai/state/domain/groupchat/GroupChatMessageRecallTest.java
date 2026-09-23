package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.*;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.Date;
import javax.sql.DataSource;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatMessageRecallService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTopicService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;

/** 真实 Spring 事务代理验证提交边界，JDBC 替身不代表目标数据库并发验证。 */
class GroupChatMessageRecallTest {
    private final GroupChatAuthorizationService auth = mock(GroupChatAuthorizationService.class);
    private final GroupChatTopicService topics = mock(GroupChatTopicService.class);
    private final ByaiMessageMapper messages = mock(ByaiMessageMapper.class);
    private final GroupChatEventPublisher events = mock(GroupChatEventPublisher.class);
    private final Connection connection = mock(Connection.class);
    private final ByaiSessionMember member = new ByaiSessionMember();
    private ByaiMessage source;
    private GroupChatMessageRecallService service;

    @BeforeEach
    void setUp() throws Exception {
        LoginInfo login = new LoginInfo();
        login.setUserId(10L);
        CurrentUserHolder.setLoginInfo(login);
        member.setUserRole("MEMBER");
        when(auth.requireCurrentUserMember(20L)).thenReturn(member);
        source = new ByaiMessage();
        source.setMessageId(30L);
        source.setSessionId(20L);
        source.setUsage(1);
        source.setCreatorId(10L);
        source.setCreateTime(new Date(1));
        source.setMessageContent("retained original");
        source.setTopicId(5L);
        source.setMessageRef(6L);
        when(messages.selectForRecall(20L, 30L)).thenReturn(source);
        when(messages.recallGroupMessage(eq(20L), eq(30L), eq(10L), any(Date.class))).thenReturn(1);
        DataSource dataSource = mock(DataSource.class);
        when(dataSource.getConnection()).thenReturn(connection);
        when(connection.getAutoCommit()).thenReturn(true);
        doAnswer(call -> { verifyNoInteractions(events); return null; }).when(connection).commit();
        TransactionInterceptor interceptor = new TransactionInterceptor();
        interceptor.setTransactionManager(new DataSourceTransactionManager(dataSource));
        interceptor.setTransactionAttributeSource(new AnnotationTransactionAttributeSource());
        ProxyFactory factory = new ProxyFactory(new GroupChatMessageRecallService(auth, topics, messages, events));
        factory.setProxyTargetClass(true);
        factory.addAdvice(interceptor);
        service = (GroupChatMessageRecallService) factory.getProxy();
    }

    @AfterEach
    void clear() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void oldOwnMessageChangesOnlyStateAndPublishesAfterCommit() throws Exception {
        JSONObject result = service.recall(20L, 30L);
        assertThat(result.getBoolean("recalled")).isTrue();
        assertThat(result).doesNotContainKeys("event", "type");
        assertThat(source.getMessageContent()).isEqualTo("retained original");
        assertThat(source.getTopicId()).isEqualTo(5L);
        assertThat(source.getMessageRef()).isEqualTo(6L);
        assertThat(source.getUsage()).isEqualTo(1);
        verify(connection).commit();
        var event = ArgumentCaptor.forClass(JSONObject.class);
        verify(events).publish(eq(20L), event.capture(), isNull());
        assertThat(event.getValue().getString("event")).isEqualTo("MESSAGE_RECALLED");
        assertThat(event.getValue().toJSONString()).doesNotContain("retained original");
        verify(messages, never()).insert(any(ByaiMessage.class));
        verify(topics, never()).persistMessage(any());
        var order = inOrder(topics, messages);
        order.verify(topics).lockGroup(20L);
        order.verify(messages).selectForRecall(20L, 30L);
    }

    @Test
    void retryKeepsFirstActorAndDoesNotWriteOrBroadcast() {
        source.setRecalledAt(new Date(100));
        source.setRecalledBy(99L);
        service.recall(20L, 30L);
        verify(messages, never()).recallGroupMessage(any(), any(), any(), any());
        verifyNoInteractions(events);
        assertThat(source.getRecalledBy()).isEqualTo(99L);
    }

    @Test
    void systemMessageIsRejectedEvenForOwner() {
        member.setUserRole("OWNER");
        source.setUsage(5);
        assertThatThrownBy(() -> service.recall(20L, 30L)).isInstanceOf(IllegalArgumentException.class);
        verifyNoInteractions(events);
    }

    @Test
    void agentWithSameNumericIdIsNotOwnedByUserAndRetryDoesNotBypassPermission() {
        source.setUsage(2);
        source.setRecalledAt(new Date());
        assertThatThrownBy(() -> service.recall(20L, 30L)).isInstanceOf(IllegalArgumentException.class);
        verify(messages, never()).recallGroupMessage(any(), any(), any(), any());
    }

    @Test
    void memberCannotRecallOtherUserButAdminCanRecallAgent() {
        source.setCreatorId(99L);
        assertThatThrownBy(() -> service.recall(20L, 30L)).isInstanceOf(IllegalArgumentException.class);
        member.setUserRole("ADMIN");
        source.setUsage(2);
        service.recall(20L, 30L);
        verify(events).publish(eq(20L), any(), isNull());
    }

    @Test
    void foreignGroupAndNonMemberCannotRecall() {
        source.setSessionId(99L);
        assertThatThrownBy(() -> service.recall(20L, 30L)).isInstanceOf(IllegalArgumentException.class);
        when(auth.requireCurrentUserMember(20L)).thenThrow(new IllegalArgumentException("not a member"));
        assertThatThrownBy(() -> service.recall(20L, 30L)).isInstanceOf(IllegalArgumentException.class);
        verify(messages, never()).recallGroupMessage(any(), any(), any(), any());
    }

    @Test
    void failedUpdateRollsBackWithoutBroadcast() throws Exception {
        when(messages.recallGroupMessage(eq(20L), eq(30L), eq(10L), any(Date.class))).thenReturn(0);
        assertThatThrownBy(() -> service.recall(20L, 30L)).isInstanceOf(IllegalStateException.class);
        verify(connection).rollback();
        verifyNoInteractions(events);
    }

    @Test
    void committedRecallSurvivesBroadcastFailure() throws Exception {
        when(events.publish(eq(20L), any(), isNull())).thenThrow(new IllegalStateException("offline"));
        assertThat(service.recall(20L, 30L).getBoolean("recalled")).isTrue();
        verify(connection).commit();
    }

    @Test
    void failedCommitNeverPublishes() throws Exception {
        doThrow(new SQLException("commit failed")).when(connection).commit();
        assertThatThrownBy(() -> service.recall(20L, 30L)).isInstanceOf(RuntimeException.class);
        verifyNoInteractions(events);
    }
}
