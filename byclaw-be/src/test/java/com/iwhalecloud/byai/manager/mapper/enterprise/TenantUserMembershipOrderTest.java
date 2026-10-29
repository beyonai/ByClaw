package com.iwhalecloud.byai.manager.mapper.enterprise;

import com.iwhalecloud.byai.manager.vo.enterprise.UserEnterpriseVo;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.session.Configuration;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.junit.jupiter.api.Test;

import java.sql.Connection;
import java.sql.DriverManager;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** 执行实际 Mapper 查询，验证创建时间、成员加入时间和系统企业的排序边界。 */
class TenantUserMembershipOrderTest {

    @Test
    void ordersByEnterpriseCreationAndKeepsDefaultWithoutMembership() throws Exception {
        try (var connection = database("enterprise_creation_order")) {
            try (var statement = connection.createStatement()) {
                statement.execute("""
                    INSERT INTO po_enterprise_info VALUES
                        (1, 'Default', 'default'), (20, 'Old', 'old'),
                        (30, 'New', 'new'), (40, 'Same time', 'same'),
                        (50, 'Legacy', 'legacy'), (60, 'Other user', 'other')
                    """);
                statement.execute("""
                    INSERT INTO tenant_config VALUES
                        (20, 'PROVISION_REQUEST_ID', TIMESTAMP '2026-01-01 00:00:00'),
                        (30, 'PROVISION_REQUEST_ID', TIMESTAMP '2026-03-01 00:00:00'),
                        (40, 'PROVISION_REQUEST_ID', TIMESTAMP '2026-03-01 00:00:00'),
                        (60, 'PROVISION_REQUEST_ID', TIMESTAMP '2026-04-01 00:00:00')
                    """);
                statement.execute("""
                    INSERT INTO tenant_user_membership VALUES
                        (20, 7, 'MEMBER', 'ACTIVE', TIMESTAMP '2026-06-01 00:00:00'),
                        (30, 7, 'OWNER', 'ACTIVE', TIMESTAMP '2026-03-01 00:00:00'),
                        (40, 7, 'MEMBER', 'DISABLED', TIMESTAMP '2026-04-01 00:00:00'),
                        (50, 8, 'OWNER', 'ACTIVE', TIMESTAMP '2026-02-01 00:00:00'),
                        (50, 7, 'MEMBER', 'ACTIVE', TIMESTAMP '2026-07-01 00:00:00'),
                        (60, 8, 'OWNER', 'ACTIVE', TIMESTAMP '2026-04-01 00:00:00')
                    """);
            }
            List<UserEnterpriseVo> enterprises = query(connection, 7L);
            assertThat(enterprises).extracting(UserEnterpriseVo::getEnterpriseId)
                .containsExactly(40L, 30L, 50L, 20L, 1L);
            assertThat(enterprises.get(0).getStatus()).isEqualTo("DISABLED");
            assertThat(enterprises.get(4).getRole()).isEqualTo("MEMBER");
            assertThat(enterprises.get(4).getStatus()).isEqualTo("ACTIVE");
        }
    }

    @Test
    void existingDefaultMembershipIsNotDuplicatedAndParticipatesInSorting() throws Exception {
        try (var connection = database("enterprise_default_order")) {
            try (var statement = connection.createStatement()) {
                statement.execute("INSERT INTO po_enterprise_info VALUES (1, 'Default', 'default'), (20, 'Old', 'old')");
                statement.execute("""
                    INSERT INTO tenant_user_membership VALUES
                        (1, 7, 'ADMIN', 'ACTIVE', TIMESTAMP '2026-03-01 00:00:00'),
                        (20, 7, 'MEMBER', 'ACTIVE', TIMESTAMP '2026-01-01 00:00:00')
                    """);
            }
            List<UserEnterpriseVo> enterprises = query(connection, 7L);
            assertThat(enterprises).extracting(UserEnterpriseVo::getEnterpriseId).containsExactly(1L, 20L);
            assertThat(enterprises.get(0).getRole()).isEqualTo("ADMIN");
        }
    }

    @Test
    void userWithoutMembershipOnlySeesDefaultEnterprise() throws Exception {
        try (var connection = database("enterprise_default_only")) {
            try (var statement = connection.createStatement()) {
                statement.execute("INSERT INTO po_enterprise_info VALUES (1, 'Default', 'default'), (20, 'Other', 'other')");
            }
            assertThat(query(connection, 7L)).extracting(UserEnterpriseVo::getEnterpriseId).containsExactly(1L);
        }
    }

    private Connection database(String name) throws Exception {
        Connection connection = DriverManager.getConnection(
            "jdbc:h2:mem:" + name + ";MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE");
        try (var statement = connection.createStatement()) {
            statement.execute("""
                CREATE TABLE po_enterprise_info (
                    enterprise_id BIGINT PRIMARY KEY, com_acct_name VARCHAR(200), com_acct_code VARCHAR(100))
                """);
            statement.execute("""
                CREATE TABLE tenant_user_membership (
                    enterprise_id BIGINT, user_id BIGINT, role VARCHAR(16), status VARCHAR(16), joined_at TIMESTAMP,
                    UNIQUE (enterprise_id, user_id))
                """);
            statement.execute("""
                CREATE TABLE tenant_config (
                    enterprise_id BIGINT, params_code VARCHAR(64), created_at TIMESTAMP,
                    UNIQUE (enterprise_id, params_code))
                """);
        }
        return connection;
    }

    private List<UserEnterpriseVo> query(Connection connection, Long userId) throws Exception {
        String resource = "com/iwhalecloud/byai/manager/mapper/enterprise/TenantUserMembershipMapper.xml";
        Configuration configuration = new Configuration();
        try (var input = getClass().getClassLoader().getResourceAsStream(resource)) {
            new XMLMapperBuilder(input, configuration, resource, configuration.getSqlFragments()).parse();
        }
        try (var session = new SqlSessionFactoryBuilder().build(configuration).openSession(connection)) {
            return session.selectList(TenantUserMembershipMapper.class.getName() + ".listUserEnterprises",
                Map.of("userId", userId));
        }
    }
}
