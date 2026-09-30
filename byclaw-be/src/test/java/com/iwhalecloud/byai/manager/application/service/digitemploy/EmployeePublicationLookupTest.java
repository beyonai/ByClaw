package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.iwhalecloud.byai.manager.mapper.resource.DigitalEmployeePublicationMapper;
import java.sql.Connection;
import java.sql.DriverManager;
import java.util.Date;
import java.util.List;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.Configuration;
import org.apache.ibatis.session.SqlSession;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import static org.assertj.core.api.Assertions.assertThat;

/** 执行真实 Mapper 查询，验证当前记录优先级、时间相同的排序及租户隔离。 */
class EmployeePublicationLookupTest {
    Connection connection;
    SqlSession session;
    DigitalEmployeePublicationMapper mapper;

    @BeforeEach void setup() throws Exception {
        connection = DriverManager.getConnection("jdbc:sqlite::memory:");
        try (var statement = connection.createStatement()) {
            statement.execute("ATTACH DATABASE ':memory:' AS byai");
            statement.execute("CREATE TABLE byai.digital_employee_publication "
                + "(request_id BIGINT, source_id BIGINT, tenant_id BIGINT, status TEXT, created_at BIGINT)");
        }
        Configuration configuration = new Configuration();
        configuration.setMapUnderscoreToCamelCase(true);
        configuration.setEnvironment(new Environment("publication", new JdbcTransactionFactory(), new SingleConnectionDataSource(connection, true)));
        configuration.addMapper(DigitalEmployeePublicationMapper.class);
        session = new SqlSessionFactoryBuilder().build(configuration).openSession(connection);
        mapper = session.getMapper(DigitalEmployeePublicationMapper.class);
    }

    @AfterEach void close() throws Exception {
        if (session != null) session.close();
        if (connection != null && !connection.isClosed()) connection.close();
    }

    void insert(long id, long source, long tenant, String state, long created) throws Exception {
        try (var statement = connection.prepareStatement("INSERT INTO byai.digital_employee_publication VALUES (?,?,?,?,?)")) {
            statement.setLong(1, id); statement.setLong(2, source); statement.setLong(3, tenant);
            statement.setString(4, state); statement.setLong(5, created); statement.executeUpdate();
        }
        session.clearCache();
    }

    @Test void currentAndBatchPreferActiveRequestsAndNeverCrossTenant() throws Exception {
        insert(10, 100, 1, "REJECTED", 1000);
        insert(11, 100, 1, "DRAFT", 2000);
        insert(12, 100, 1, "REJECTED", 3000);
        insert(13, 100, 2, "PENDING", 4000);
        insert(14, 200, 1, "PUBLISHED", 2000);
        assertThat(mapper.current(100L, 1L).getRequestId()).isEqualTo(11L);
        assertThat(mapper.currentStatuses(List.of(100L, 200L), 1L))
            .extracting(row -> row.getSourceId() + ":" + row.getStatus()).containsExactlyInAnyOrder("100:DRAFT", "200:PUBLISHED");
        assertThat(mapper.current(100L, 3L)).isNull();
    }

    @Test void latestResultUsesRequestIdToBreakCreationTimeTies() throws Exception {
        insert(10, 100, 1, "REJECTED", 1000);
        insert(11, 100, 1, "WITHDRAWN", 1000);
        assertThat(mapper.current(100L, 1L).getRequestId()).isEqualTo(11L);
    }

    @Test void previousRejectionOnlyReadsEarlierRecordsOfTheSameEmployeeAndTenant() throws Exception {
        insert(10, 100, 1, "REJECTED", 1000);
        insert(11, 100, 1, "DRAFT", 1000);
        insert(12, 100, 1, "REJECTED", 1000);
        insert(13, 100, 2, "REJECTED", 500);
        insert(14, 200, 1, "REJECTED", 500);
        assertThat(mapper.previousRejection(100L, 1L, new Date(1000), 11L).getRequestId()).isEqualTo(10L);
        assertThat(mapper.previousRejection(100L, 1L, new Date(500), 20L)).isNull();
    }
}
