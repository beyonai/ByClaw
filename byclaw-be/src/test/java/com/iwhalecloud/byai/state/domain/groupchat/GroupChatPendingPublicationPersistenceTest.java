package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.Date;
import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.SqlSessionFactory;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mybatis.spring.SqlSessionTemplate;
import org.mybatis.spring.transaction.SpringManagedTransactionFactory;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;
import org.springframework.transaction.support.TransactionTemplate;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.MybatisSqlSessionFactoryBuilder;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatPendingPublication;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatPendingPublicationMapper;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatPendingPublicationStore;
import com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService;

class GroupChatPendingPublicationPersistenceTest {
    @TempDir Path temporary;

    @Test
    void checkpointCommitsDespiteOuterRollbackAndTaskHasOnlyOnePendingRow() throws Exception {
        String url = "jdbc:sqlite:" + temporary.resolve("pending.sqlite");
        try (Connection connection = DriverManager.getConnection(url); Statement statement = connection.createStatement()) {
            statement.execute("""
                CREATE TABLE byai_group_chat_pending_publication (
                    task_session_id BIGINT NOT NULL PRIMARY KEY,
                    pending_publication_id BIGINT NOT NULL UNIQUE,
                    text_content TEXT, source_files_json TEXT, uploaded_files_json TEXT,
                    cloud_resource_id BIGINT, create_time TIMESTAMP
                )
                """);
        }
        UnpooledDataSource datasource = new UnpooledDataSource("org.sqlite.JDBC", url, null, null);
        MybatisConfiguration configuration = new MybatisConfiguration(
            new Environment("pending-test", new SpringManagedTransactionFactory(), datasource));
        configuration.setMapUnderscoreToCamelCase(true);
        configuration.addMapper(ByaiGroupChatPendingPublicationMapper.class);
        SqlSessionFactory factory = new MybatisSqlSessionFactoryBuilder().build(configuration);
        ByaiGroupChatPendingPublicationMapper mapper = new SqlSessionTemplate(factory)
            .getMapper(ByaiGroupChatPendingPublicationMapper.class);
        ByaiGroupChatPendingPublication pending = new ByaiGroupChatPendingPublication();
        pending.setTaskSessionId(60L);
        pending.setPendingPublicationId(100L);
        pending.setTextContent("private");
        pending.setSourceFilesJson("[]");
        pending.setUploadedFilesJson("{}");
        pending.setCreateTime(new Date());
        mapper.insert(pending);
        assertThatThrownBy(() -> mapper.insert(pending)).isInstanceOf(RuntimeException.class);

        DataSourceTransactionManager transactions = new DataSourceTransactionManager(datasource);
        GroupChatPendingPublicationStore target = new GroupChatPendingPublicationStore(mapper,
            mock(MultiDeviceBroadcastService.class));
        ProxyFactory proxy = new ProxyFactory(target);
        proxy.setProxyTargetClass(true);
        proxy.addAdvice(new TransactionInterceptor(transactions, new AnnotationTransactionAttributeSource()));
        GroupChatPendingPublicationStore store = (GroupChatPendingPublicationStore) proxy.getProxy();
        new TransactionTemplate(transactions).executeWithoutResult(status -> {
            store.checkpoint(100L, 777L, "{\"uploaded\":[]}");
            status.setRollbackOnly();
        });
        assertThat(mapper.selectById(60L).getUploadedFilesJson()).isEqualTo("{\"uploaded\":[]}");
        assertThat(mapper.selectById(60L).getCloudResourceId()).isEqualTo(777L);
        assertThatThrownBy(() -> store.checkpoint(99L, 777L, "{}"))
            .hasMessageContaining("changed during upload");
        assertThat(mapper.selectById(60L).getPendingPublicationId()).isEqualTo(100L);
    }
}
