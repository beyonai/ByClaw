package com.iwhalecloud.byai.manager.mapper.message;

import static org.assertj.core.api.Assertions.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.*;
import java.time.LocalDateTime;
import java.util.regex.Pattern;

import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.apache.ibatis.type.BaseTypeHandler;
import org.apache.ibatis.type.JdbcType;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.iwhalecloud.byai.manager.entity.message.MessageShareLink;

class MessageShareLinkIsolationTest {
    @TempDir Path directory;

    @Test void legacyMessageAndInvitationWithSameIdAndTokenRemainIsolated() throws Exception {
        String url = "jdbc:sqlite:" + directory.resolve("links.sqlite");
        try (Connection connection = DriverManager.getConnection(url); Statement sql = connection.createStatement()) {
            sql.execute("""
                CREATE TABLE message_share_link (
                    link_id BIGINT, link_type VARCHAR(32) DEFAULT 'MESSAGE', link_token VARCHAR(128),
                    title VARCHAR(200), creator_id BIGINT, status VARCHAR(32), access_permission VARCHAR(32),
                    expire_time TIMESTAMP, max_access_count BIGINT, current_access_count BIGINT,
                    last_access_time TIMESTAMP, create_time TIMESTAMP, update_time TIMESTAMP, com_acct_id BIGINT
                )
                """);
            // Execute the migration's actual expression indexes on a disposable local database.
            String migration = Files.readString(Path.of("../deploy/migrations/versions/V0.4.1/V0.4.1__ddl.sql"));
            var indexes = Pattern.compile("CREATE UNIQUE INDEX IF NOT EXISTS uk_message_share_link_[\\s\\S]*?;")
                .matcher(migration);
            int count = 0;
            while (indexes.find()) {
                sql.execute(indexes.group().replace("byai.message_share_link", "message_share_link"));
                count++;
            }
            assertThat(count).isEqualTo(2);
            sql.execute("INSERT INTO message_share_link(link_id, link_token) VALUES(99, 'Default1')");
            try (ResultSet row = sql.executeQuery("SELECT link_type FROM message_share_link WHERE link_id = 99")) {
                assertThat(row.next()).isTrue();
                assertThat(row.getString(1)).isEqualTo("MESSAGE");
            }
        }
        var config = new MybatisConfiguration(new Environment("sqlite", new JdbcTransactionFactory(),
            new UnpooledDataSource("org.sqlite.JDBC", url, null, null)));
        config.getTypeHandlerRegistry().register(LocalDateTime.class, new SqliteDateTimeHandler());
        config.addMapper(MessageShareLinkMapper.class);
        try (var session = new SqlSessionFactoryBuilder().build(config).openSession(true)) {
            var mapper = session.getMapper(MessageShareLinkMapper.class);
            var now = LocalDateTime.now();
            var legacy = link(null, 20L, "Ab1234CD", now);
            var invitation = link("GROUP_INVITATION", 20L, "Ab1234CD", now);
            assertThat(mapper.insert(legacy)).isEqualTo(1);
            assertThat(mapper.insert(invitation)).isEqualTo(1);
            assertThat(mapper.selectByLinkToken("Ab1234CD").getLinkType()).isNull();
            assertThat(mapper.selectInvitationByToken("Ab1234CD").getLinkType()).isEqualTo("GROUP_INVITATION");
            mapper.incrementAccessCountAndUpdateTime(20L, now);
            assertThat(mapper.selectByLinkToken("Ab1234CD").getCurrentAccessCount()).isEqualTo(1);
            assertThat(mapper.selectInvitationBySessionId(20L).getCurrentAccessCount()).isZero();

            invitation.setLinkToken("New123CD");
            invitation.setExpireTime(now.plusDays(7));
            assertThat(mapper.updateInvitation(invitation)).isEqualTo(1);
            assertThat(mapper.selectInvitationByToken("Ab1234CD")).isNull();
            assertThat(mapper.selectByLinkToken("Ab1234CD")).isNotNull();
            assertThat(mapper.selectByLinkToken("New123CD")).isNull();
            assertThat(mapper.selectInvitationByToken("New123CD").getExpireTime()).isEqualTo(now.plusDays(7));

            assertThatThrownBy(() -> mapper.insert(link("MESSAGE", 20L, "Unique12", now)))
                .hasRootCauseInstanceOf(SQLException.class);
            assertThatThrownBy(() -> mapper.insert(link("MESSAGE", 21L, "Ab1234CD", now)))
                .hasRootCauseInstanceOf(SQLException.class);
            assertThatThrownBy(() -> mapper.insert(link(null, 20L, "Unique13", now)))
                .hasRootCauseInstanceOf(SQLException.class);
            assertThatThrownBy(() -> mapper.insert(link("GROUP_INVITATION", 21L, "New123CD", now)))
                .hasRootCauseInstanceOf(SQLException.class);
            assertThatThrownBy(() -> mapper.insert(link("GROUP_INVITATION", 20L, "Unique14", now)))
                .hasRootCauseInstanceOf(SQLException.class);
        }
    }

    private MessageShareLink link(String type, Long id, String token, LocalDateTime now) {
        return MessageShareLink.builder().linkType(type).linkId(id).linkToken(token).creatorId(10L)
            .comAcctId(3L).status("ACTIVE").accessPermission("PUBLIC").currentAccessCount(0L)
            .createTime(now).updateTime(now).expireTime(now.plusDays(1)).build();
    }

    // SQLite JDBC does not support JDBC 4.2 getObject(LocalDateTime.class).
    static class SqliteDateTimeHandler extends BaseTypeHandler<LocalDateTime> {
        @Override public void setNonNullParameter(PreparedStatement ps, int i, LocalDateTime value, JdbcType type)
            throws SQLException { ps.setString(i, value.toString()); }
        @Override public LocalDateTime getNullableResult(ResultSet rs, String column) throws SQLException {
            return parse(rs.getString(column));
        }
        @Override public LocalDateTime getNullableResult(ResultSet rs, int column) throws SQLException {
            return parse(rs.getString(column));
        }
        @Override public LocalDateTime getNullableResult(CallableStatement cs, int column) throws SQLException {
            return parse(cs.getString(column));
        }
        private LocalDateTime parse(String value) { return value == null ? null : LocalDateTime.parse(value); }
    }
}
