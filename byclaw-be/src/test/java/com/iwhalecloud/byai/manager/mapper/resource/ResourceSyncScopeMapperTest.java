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
    void synchronizationUsesPersonalCodesWithinTheActiveTenant() throws Exception {
        var source = new UnpooledDataSource("org.h2.Driver",
            "jdbc:h2:mem:sync_scope_" + UUID.randomUUID() + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1", "sa", "");
        try (var connection = source.getConnection(); var statement = connection.createStatement()) {
            statement.execute("CREATE SCHEMA byai");
            statement.execute("CREATE TABLE byai.po_users (user_id BIGINT PRIMARY KEY, state VARCHAR(1), "
                + "assistant_id BIGINT, user_code VARCHAR(64))");
            statement.execute("INSERT INTO byai.po_users VALUES (1, 'A', 1, 'user_1'), (2, 'X', 2, 'user2'), "
                + "(3, 'A', 900, 'user3'), (4, 'A', 4, 'user4'), (5, 'A', NULL, 'user5'), "
                + "(6, 'A', NULL, 'user6'), (7, 'A', NULL, NULL), (8, 'A', NULL, '')");
            statement.execute("CREATE TABLE byai.po_organization (org_id BIGINT PRIMARY KEY)");
            statement.execute("INSERT INTO byai.po_organization VALUES (10)");
            statement.execute("CREATE TABLE byai.po_position (position_id BIGINT PRIMARY KEY, is_digital_position INT)");
            statement.execute("INSERT INTO byai.po_position VALUES (20, 0), (21, 1)");
            statement.execute("CREATE TABLE byai.tenant_user_membership (user_id BIGINT, enterprise_id BIGINT, status VARCHAR(16))");
            statement.execute("INSERT INTO byai.tenant_user_membership VALUES (1,1,'ACTIVE'),(2,1,'ACTIVE'),(3,1,'ACTIVE'),(4,1,'ACTIVE'),(5,1,'ACTIVE'),(6,1,'ACTIVE'),(7,1,'ACTIVE'),(8,1,'ACTIVE')");
            // The selected default is unrelated to the stable personal assistant code.
            statement.execute("CREATE TABLE byai.suas_superassist (superassist_id BIGINT PRIMARY KEY, "
                + "create_user BIGINT, default_dig_employee_id BIGINT, status VARCHAR(2), com_acct_id BIGINT)");
            statement.execute("INSERT INTO byai.suas_superassist VALUES "
                + "(1, 999, 90, '00', 999), (900, 999, 91, '00', 1), (4, 999, 92, '00', 1)");
            statement.execute("CREATE TABLE byai.ss_resource (resource_id BIGINT PRIMARY KEY, "
                + "resource_code VARCHAR(128), resource_biz_type VARCHAR(32), resource_status INT, com_acct_id BIGINT DEFAULT 1)");
            statement.execute("INSERT INTO byai.ss_resource (resource_id, resource_code, resource_biz_type, resource_status) VALUES "
                + "(20, 'user_1_personal', 'DIG_EMPLOYEE', 2), (21, 'user3_personal', 'DIG_EMPLOYEE', 2), "
                + "(23, 'user5_personal', 'DIG_EMPLOYEE', 2), (24, 'userX1_personal', 'DIG_EMPLOYEE', 2), "
                + "(25, 'user_1_personal', 'DIG_EMPLOYEE', -1), (26, 'user_1_personal', 'SKILL', 2), "
                + "(27, 'user6_personal', 'DIG_EMPLOYEE', 2), (28, 'user6_personal', 'DIG_EMPLOYEE', 2), "
                + "(29, '_personal', 'DIG_EMPLOYEE', 2), (30, 'user4_personal', 'DIG_EMPLOYEE', -1), "
                + "(90, 'user_1_main', 'DIG_EMPLOYEE', 2), (91, 'other_employee', 'DIG_EMPLOYEE', 2), "
                + "(92, 'user4_main', 'DIG_EMPLOYEE', 2)");
        }
        var configuration = new Configuration(new Environment("test", new JdbcTransactionFactory(), source));
        configuration.addMapper(ResourceSyncScopeMapper.class);
        try (var session = new SqlSessionFactoryBuilder().build(configuration).openSession()) {
            var mapper = session.getMapper(ResourceSyncScopeMapper.class);
            assertThat(mapper.activeTenantUsers(List.of(1L, 2L, 3L, 4L, 1L), 1L)).containsExactlyInAnyOrder(1L, 3L, 4L);
            assertThat(mapper.organization(10L)).isEqualTo(1);
            assertThat(mapper.organization(11L)).isZero();
            assertThat(mapper.ordinaryPost(20L)).isEqualTo(1);
            assertThat(mapper.ordinaryPost(21L)).isZero();
            // Exact code matching ignores the chosen default, deleted duplicates and other resource types.
            assertThat(mapper.personalAssistants(1L, 1L)).containsExactly(20L);
            assertThat(mapper.personalAssistants(3L, 1L)).containsExactly(21L);
            // A personal assistant is found even without a superassist or a selected default.
            assertThat(mapper.personalAssistants(5L, 1L)).containsExactly(23L);
            // A default employee is never used as a fallback when the personal assistant is missing/deleted.
            assertThat(mapper.personalAssistants(4L, 1L)).isEmpty();
            assertThat(mapper.personalAssistants(6L, 1L)).containsExactlyInAnyOrder(27L, 28L);
            assertThat(mapper.personalAssistants(7L, 1L)).isEmpty();
            assertThat(mapper.personalAssistants(8L, 1L)).isEmpty();
            assertThat(mapper.personalAssistantsBatch(List.of(1L, 3L, 4L, 5L, 6L, 7L, 8L), 1L))
                .containsExactlyInAnyOrder(new ResourceSyncScopeMapper.UserAssistantRow(1L, 20L),
                    new ResourceSyncScopeMapper.UserAssistantRow(3L, 21L),
                    new ResourceSyncScopeMapper.UserAssistantRow(5L, 23L),
                    new ResourceSyncScopeMapper.UserAssistantRow(6L, 27L),
                    new ResourceSyncScopeMapper.UserAssistantRow(6L, 28L));
            assertThat(mapper.personalAssistants(1L, 2L)).isEmpty();
            assertThat(mapper.activeTenantUsers(List.of(1L), 2L)).isEmpty();
            try (var statement = session.getConnection().createStatement()) {
                statement.execute("UPDATE byai.suas_superassist SET default_dig_employee_id = 92");
            }
            session.clearCache();
            assertThat(mapper.personalAssistants(1L, 1L)).containsExactly(20L);
        } finally {
            try (var connection = source.getConnection(); var statement = connection.createStatement()) {
                statement.execute("SHUTDOWN");
            }
        }
    }
}
