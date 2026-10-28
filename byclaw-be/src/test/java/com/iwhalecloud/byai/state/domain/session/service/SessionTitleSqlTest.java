package com.iwhalecloud.byai.state.domain.session.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.MybatisSqlSessionFactoryBuilder;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.util.concurrent.Executor;
import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;

class SessionTitleSqlTest {
    @TempDir
    Path directory;

    @AfterEach
    void clearUser() {
        CurrentUserHolder.clearLoginInfo();
    }

    @ParameterizedTest
    @NullSource
    @ValueSource(strings = {"ACTIVE", "{\"phase\":\"chat\"}"})
    void updatesTitlesForNullableOrStructuredSessionState(String state) throws Exception {
        enrich(state, 100L, false, true);
    }

    @Test
    void doesNotUpdateAnotherUsersSession() throws Exception {
        enrich(null, 101L, false, false);
    }

    @Test
    void doesNotPublishForDeletedSession() throws Exception {
        enrich(null, 100L, true, false);
    }

    private void enrich(String state, long owner, boolean deleted, boolean changed) throws Exception {
        String url = "jdbc:sqlite:" + directory.resolve("titles.sqlite");
        try (var connection = DriverManager.getConnection(url); var sql = connection.createStatement()) {
            sql.execute("CREATE TABLE byai_session(session_id BIGINT, session_name TEXT, creator_id BIGINT,"
                + " state TEXT, update_by BIGINT, update_time TIMESTAMP)");
            try (var insert = connection.prepareStatement("INSERT INTO byai_session VALUES (10,'Local title',?,?,NULL,NULL)")) {
                insert.setLong(1, owner);
                insert.setString(2, state);
                insert.executeUpdate();
            }
            if (deleted) sql.execute("DELETE FROM byai_session WHERE session_id=10");
        }
        var configuration = new MybatisConfiguration(new Environment("titles", new JdbcTransactionFactory(),
            new UnpooledDataSource("org.sqlite.JDBC", url, null, null)));
        configuration.addMapper(ByaiSessionMapper.class);
        try (var sqlSession = new MybatisSqlSessionFactoryBuilder().build(configuration).openSession()) {
            var ext = mock(SessionExtService.class);
            when(ext.deleteBySessionIdAndParamCode(10L, SessionTitleService.SUMMARY_PENDING_CODE)).thenReturn(1);
            var broadcast = mock(MultiDeviceBroadcastService.class);
            var service = new SessionTitleService(sqlSession.getMapper(ByaiSessionMapper.class), ext,
                mock(SequenceService.class));
            ReflectionTestUtils.setField(service, "titleExecutor", (Executor) Runnable::run);
            ReflectionTestUtils.setField(service, "transactionManager", mock(PlatformTransactionManager.class));
            ReflectionTestUtils.setField(service, "broadcastService", broadcast);
            var login = new LoginInfo();
            login.setUserId(100L);
            CurrentUserHolder.setLoginInfo(login);
            service.summarizeAsync(10L, "Local title", () -> "Generated title");
            try (var query = sqlSession.getConnection().createStatement();
                var row = query.executeQuery("SELECT session_name, state FROM byai_session WHERE session_id=10")) {
                assertThat(row.next()).isEqualTo(!deleted);
                if (!deleted) {
                    assertThat(row.getString("session_name")).isEqualTo(changed ? "Generated title" : "Local title");
                    assertThat(row.getString("state")).isEqualTo(state);
                }
            }
            if (changed) verify(broadcast).broadcastToUserDevices(eq(100L), eq(10L), eq("sessionTitleUpdated"), any(), any());
            else verifyNoInteractions(broadcast);
        }
    }
}
