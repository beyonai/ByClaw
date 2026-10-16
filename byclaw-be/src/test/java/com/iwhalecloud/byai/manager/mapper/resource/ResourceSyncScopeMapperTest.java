package com.iwhalecloud.byai.manager.mapper.resource;

import java.util.List;
import java.util.UUID;
import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.Configuration;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class ResourceSyncScopeMapperTest {
    @Test
    void synchronizationSubjectsCanBeValidatedWithoutTenantTables() throws Exception {
        var source = new UnpooledDataSource("org.h2.Driver",
            "jdbc:h2:mem:sync_scope_" + UUID.randomUUID() + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1", "sa", "");
        try (var connection = source.getConnection(); var statement = connection.createStatement()) {
            statement.execute("CREATE SCHEMA byai");
            statement.execute("CREATE TABLE byai.po_users (user_id BIGINT PRIMARY KEY, state VARCHAR(1))");
            statement.execute("INSERT INTO byai.po_users VALUES (1, 'A'), (2, 'X'), (3, 'A')");
            statement.execute("CREATE TABLE byai.po_organization (org_id BIGINT PRIMARY KEY)");
            statement.execute("INSERT INTO byai.po_organization VALUES (10)");
            statement.execute("CREATE TABLE byai.po_position (position_id BIGINT PRIMARY KEY, is_digital_position INT)");
            statement.execute("INSERT INTO byai.po_position VALUES (20, 0), (21, 1)");
            statement.execute("CREATE TABLE byai.suas_superassist (create_user BIGINT, default_dig_employee_id BIGINT, "
                + "status VARCHAR(2), com_acct_id BIGINT)");
            statement.execute("INSERT INTO byai.suas_superassist VALUES "
                + "(1, 20, '00', 999), (3, 20, '00', 1), (3, 21, '00', 2), (4, 22, '99', 1)");
        }
        var configuration = new Configuration(new Environment("test", new JdbcTransactionFactory(), source));
        configuration.addMapper(ResourceSyncScopeMapper.class);
        try (var session = new SqlSessionFactoryBuilder().build(configuration).openSession()) {
            var mapper = session.getMapper(ResourceSyncScopeMapper.class);
            assertThat(mapper.activeUsers(List.of(1L, 2L, 3L, 4L, 1L))).containsExactlyInAnyOrder(1L, 3L);
            assertThat(mapper.organization(10L)).isEqualTo(1);
            assertThat(mapper.organization(11L)).isZero();
            assertThat(mapper.ordinaryPost(20L)).isEqualTo(1);
            assertThat(mapper.ordinaryPost(21L)).isZero();
            assertThat(mapper.defaultEmployees(1L)).containsExactly(20L);
            assertThat(mapper.defaultEmployeesForUpdate(1L)).containsExactly(20L);
            assertThat(mapper.defaultEmployees(3L)).containsExactlyInAnyOrder(20L, 21L);
            assertThat(mapper.defaultEmployeesBatch(List.of(1L, 3L, 4L))).hasSize(3);
        } finally {
            try (var connection = source.getConnection(); var statement = connection.createStatement()) {
                statement.execute("SHUTDOWN");
            }
        }
    }
}
