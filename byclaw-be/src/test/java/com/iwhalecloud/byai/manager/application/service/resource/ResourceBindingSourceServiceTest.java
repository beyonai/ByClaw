package com.iwhalecloud.byai.manager.application.service.resource;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.entity.resource.ResourceBindingSource;
import com.iwhalecloud.byai.manager.mapper.resource.ResourceBindingSourceMapper;
import java.util.UUID;
import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import static org.assertj.core.api.Assertions.assertThat;

class ResourceBindingSourceServiceTest {
    @Test void synchronizationKeepsTenantAndResourceLedgersIsolated() throws Exception {
        var source = new UnpooledDataSource("org.h2.Driver",
            "jdbc:h2:mem:sync_sources_" + UUID.randomUUID() + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1", "sa", "");
        try (var connection = source.getConnection(); var sql = connection.createStatement()) {
            sql.execute("CREATE SCHEMA byai");
            sql.execute("CREATE TABLE byai.byai_resource_binding_source (binding_source_id BIGINT PRIMARY KEY, "
                + "com_acct_id BIGINT, resource_id BIGINT, digital_employee_id BIGINT, source_type VARCHAR(32), "
                + "source_key VARCHAR(128), source_user_id BIGINT, sync_revision BIGINT, status_cd VARCHAR(3), "
                + "create_by BIGINT, update_by BIGINT, create_time TIMESTAMP, update_time TIMESTAMP)");
            sql.execute("INSERT INTO byai.byai_resource_binding_source "
                + "(binding_source_id, com_acct_id, resource_id, digital_employee_id, source_type, source_key, status_cd) VALUES "
                + "(1, 1, 10, 20, 'THIRD_PARTY_SYNC', 'USER:5', 'A'),"
                + "(2, 2, 10, 20, 'MANUAL', 'MANUAL', 'A'),"
                + "(3, 2, 99, 20, 'MANUAL', 'MANUAL', 'A'),"
                + "(4, 2, 10, 21, 'MANUAL', 'MANUAL', 'A'),"
                + "(5, 2, 10, 20, 'THIRD_PARTY_SYNC', 'USER:6', 'X')");
        }
        var configuration = new MybatisConfiguration(new Environment("test", new JdbcTransactionFactory(), source));
        configuration.setMapUnderscoreToCamelCase(true);
        configuration.addMapper(ResourceBindingSourceMapper.class);
        try (var session = new SqlSessionFactoryBuilder().build(configuration).openSession(true)) {
            var mapper = session.getMapper(ResourceBindingSourceMapper.class);
            var service = new ResourceBindingSourceService();
            ReflectionTestUtils.setField(service, "mapper", mapper);
            assertThat(service.sources(1L, 20L, 10L)).extracting(ResourceBindingSource::getBindingSourceId)
                .containsExactly(1L);
            assertThat(service.sources(1L, 20L, 10L)).extracting(ResourceBindingSource::getBindingSourceId)
                .containsExactly(1L);
            assertThat(service.automaticSources(1L, 10L)).extracting(ResourceBindingSource::getBindingSourceId)
                .containsExactly(1L);
            var login = new LoginInfo(); login.setUserId(9L); CurrentUserHolder.setLoginInfo(login);
            var sequence = org.mockito.Mockito.mock(com.iwhalecloud.byai.state.domain.sys.service.SequenceService.class);
            org.mockito.Mockito.when(sequence.nextVal()).thenReturn(6L);
            ReflectionTestUtils.setField(service, "sequence", sequence);
            service.retain(1L, 20L, 10L, "MANUAL", null, 3L);
            var manual = mapper.selectById(2L);
            assertThat(manual.getComAcctId()).isEqualTo(2L);
            assertThat(manual.getSyncRevision()).isNull();
            assertThat(mapper.selectById(6L).getComAcctId()).isEqualTo(1L);
            assertThat(mapper.selectById(6L).getSyncRevision()).isEqualTo(3L);
            assertThat(service.sources(1L, 20L, 10L)).hasSize(2);
        } finally {
            CurrentUserHolder.setLoginInfo(null);
            try (var connection = source.getConnection(); var sql = connection.createStatement()) {
                sql.execute("SHUTDOWN");
            }
        }
    }
}
