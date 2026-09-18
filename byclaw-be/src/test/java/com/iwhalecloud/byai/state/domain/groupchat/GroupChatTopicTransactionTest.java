package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.when;

import java.nio.file.Path;

import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.IllegalTransactionStateException;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;
import org.springframework.transaction.support.TransactionTemplate;

import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTopicMapper;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTopicService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;

/** 真实 JDBC 提交/回滚验证；数据库方言 MERGE 并发行为仍需目标数据库集成验证。 */
class GroupChatTopicTransactionTest {
    @TempDir Path directory;

    @Test
    void topicFailureRollsBackInsertedMessageAndLegacyAssignmentInCallingTransaction() {
        var source = new UnpooledDataSource("org.sqlite.JDBC", "jdbc:sqlite:" + directory.resolve("tx.sqlite"), null, null);
        var jdbc = new JdbcTemplate(source);
        jdbc.execute("CREATE TABLE message (id BIGINT PRIMARY KEY, topic_id BIGINT)");
        jdbc.update("INSERT INTO message(id) VALUES (1)");
        var messages = mock(ByaiMessageMapper.class);
        var topics = mock(ByaiGroupChatTopicMapper.class);
        when(messages.selectByMessageId(1L)).thenReturn(GroupChatTopicServiceTest.message(1L, null));
        when(messages.assignGroupTopic(10L, 1L, 1L))
            .thenAnswer(call -> jdbc.update("UPDATE message SET topic_id = 1 WHERE id = 1"));
        when(messages.insert(any(ByaiMessage.class))).thenAnswer(call -> {
            ByaiMessage message = call.getArgument(0);
            return jdbc.update("INSERT INTO message VALUES (?,?)", message.getMessageId(), message.getTopicId());
        });
        when(topics.upsert(any())).thenThrow(new IllegalStateException("topic write failed"));
        var manager = new DataSourceTransactionManager(source);
        var factory = new ProxyFactory(new GroupChatTopicService(messages, topics, mock(SessionService.class)));
        factory.addAdvice(new TransactionInterceptor(manager, new AnnotationTransactionAttributeSource()));
        GroupChatTopicService service = (GroupChatTopicService) factory.getProxy();
        ByaiMessage reply = GroupChatTopicServiceTest.message(2L, 1L);
        assertThatThrownBy(() -> service.persistMessage(reply)).isInstanceOf(IllegalTransactionStateException.class);
        assertThatThrownBy(() -> new TransactionTemplate(manager).executeWithoutResult(status -> service.persistMessage(reply)))
            .hasMessage("topic write failed");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM message", Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT topic_id FROM message WHERE id = 1", Long.class)).isNull();
        doReturn(1).when(topics).upsert(any());
        new TransactionTemplate(manager).executeWithoutResult(status -> service.persistMessage(reply));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM message", Integer.class)).isEqualTo(2);
        assertThat(jdbc.queryForObject("SELECT topic_id FROM message WHERE id = 1", Long.class)).isEqualTo(1L);
    }
}
