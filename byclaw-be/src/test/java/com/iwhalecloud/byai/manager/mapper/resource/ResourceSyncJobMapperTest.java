package com.iwhalecloud.byai.manager.mapper.resource;

import java.util.UUID;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.Configuration;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import static org.assertj.core.api.Assertions.assertThat;

class ResourceSyncJobMapperTest {
    @Test void versionedLeaseExcludesLegacyWorkersAndRecoversFailedOrAbandonedJobs() {
        var source = new DriverManagerDataSource("jdbc:h2:mem:" + UUID.randomUUID()
            + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1", "sa", "");
        var jdbc = new JdbcTemplate(source);
        jdbc.execute("CREATE SCHEMA byai");
        jdbc.execute("CREATE TABLE byai.byai_resource_sync_job (sync_job_id BIGINT PRIMARY KEY, status VARCHAR(32),"
            + " retry_count INT, next_retry_time TIMESTAMP, create_time TIMESTAMP, update_time TIMESTAMP)");
        for (int id = 1; id <= 6; id++) {
            String state = switch (id) {
                case 1 -> "PENDING_V2"; case 2 -> "PARTIAL_V2"; case 3 -> "FAILED_V2";
                case 4, 5 -> "RUNNING_V2"; default -> "PENDING";
            };
            jdbc.update("INSERT INTO byai.byai_resource_sync_job VALUES (?, ?, 0, CURRENT_TIMESTAMP,"
                + " CURRENT_TIMESTAMP, CURRENT_TIMESTAMP - INTERVAL '11' MINUTE)", id, state);
        }
        jdbc.update("UPDATE byai.byai_resource_sync_job SET update_time=CURRENT_TIMESTAMP WHERE sync_job_id=5");
        String oldPredicate = "status IN ('PENDING','PARTIAL','FAILED') OR "
            + "(status='RUNNING' AND update_time < CURRENT_TIMESTAMP - INTERVAL '10' MINUTE)";
        assertThat(jdbc.queryForList("SELECT sync_job_id FROM byai.byai_resource_sync_job WHERE " + oldPredicate, Long.class))
            .containsExactly(6L);
        var config = new Configuration(new Environment("test", new JdbcTransactionFactory(), source));
        config.setMapUnderscoreToCamelCase(true);
        config.addMapper(ResourceSyncJobMapper.class);
        try (var session = new SqlSessionFactoryBuilder().build(config).openSession(true)) {
            var mapper = session.getMapper(ResourceSyncJobMapper.class);
            assertThat(mapper.pending()).extracting(job -> job.getSyncJobId()).containsExactlyInAnyOrder(1L, 2L, 3L, 4L, 6L);
            assertThat(mapper.claim(1L, 0)).isEqualTo(1);
            assertThat(mapper.claim(1L, 0)).isZero();
            assertThat(mapper.claim(5L, 0)).isZero();
            assertThat(mapper.claim(4L, 0)).isEqualTo(1);
            assertThat(mapper.claim(6L, 0)).isEqualTo(1);
            assertThat(jdbc.queryForList("SELECT sync_job_id FROM byai.byai_resource_sync_job WHERE " + oldPredicate, Long.class)).isEmpty();
            jdbc.update("UPDATE byai.byai_resource_sync_job SET next_retry_time=CURRENT_TIMESTAMP + INTERVAL '1' MINUTE WHERE sync_job_id=2");
            jdbc.update("UPDATE byai.byai_resource_sync_job SET retry_count=8 WHERE sync_job_id=3");
            assertThat(mapper.claim(2L, 0)).isZero();
            assertThat(mapper.claim(3L, 8)).isZero();
        } finally { jdbc.execute("SHUTDOWN"); }
    }
}
