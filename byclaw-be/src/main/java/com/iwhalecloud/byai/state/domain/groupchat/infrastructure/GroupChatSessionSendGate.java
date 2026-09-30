package com.iwhalecloud.byai.state.domain.groupchat.infrastructure;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import javax.sql.DataSource;
import org.springframework.stereotype.Component;
import com.iwhalecloud.byai.state.domain.chat.service.ChatGatewaySendGuard.Lease;

/**
 * 独立连接上的子会话发送锁，跨 BE 实例串行化 send/STOP。
 * 不绑定 Spring 业务事务，STOP 的同步落库回调不会等待本线程挂起的群或任务锁。
 */
@Component
public class GroupChatSessionSendGate {
    private final DataSource dataSource;

    public GroupChatSessionSendGate(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    public Lease acquire(Long sessionId) throws SQLException {
        Connection connection = dataSource.getConnection();
        try {
            connection.setAutoCommit(false);
            // 锁行单独提交，首次并发创建只容忍主键冲突。
            try (PreparedStatement insert = connection.prepareStatement(
                "INSERT INTO byai_group_chat_send_gate(session_id) SELECT ? "
                    + "WHERE NOT EXISTS (SELECT 1 FROM byai_group_chat_send_gate WHERE session_id = ?)")) {
                insert.setQueryTimeout(30);
                insert.setLong(1, sessionId);
                insert.setLong(2, sessionId);
                insert.executeUpdate();
                connection.commit();
            } catch (SQLException error) {
                connection.rollback();
                if (!"23505".equals(error.getSQLState())) throw error;
            }
            try (PreparedStatement lock = connection.prepareStatement(
                "SELECT session_id FROM byai_group_chat_send_gate WHERE session_id = ? FOR UPDATE")) {
                lock.setLong(1, sessionId);
                lock.setQueryTimeout(30);
                try (ResultSet result = lock.executeQuery()) {
                    if (!result.next()) throw new SQLException("Group send gate is missing");
                }
            }
            return () -> {
                try { connection.rollback(); }
                finally { connection.close(); }
            };
        } catch (SQLException | RuntimeException error) {
            connection.close();
            throw error;
        }
    }
}
