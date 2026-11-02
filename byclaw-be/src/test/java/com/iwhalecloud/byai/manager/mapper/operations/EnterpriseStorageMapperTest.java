package com.iwhalecloud.byai.manager.mapper.operations;

import java.util.UUID;
import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.Configuration;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.datasource.init.ScriptUtils;

import static org.assertj.core.api.Assertions.assertThat;

/** 验证实际 Mapper SQL 的企业范围、Node 项目及保留文件口径。 @author Codex @since 2026-11-02 */
class EnterpriseStorageMapperTest {
    /** 不按成员入组过滤，排除其他企业和已删项目，损坏关联留给服务层显式失败。 */
    @Test
    void includesRetainedWorkgroupCloudsOnlyWithinTheEnterprise() throws Exception {
        UnpooledDataSource source = new UnpooledDataSource("org.h2.Driver",
            "jdbc:h2:mem:storage_" + UUID.randomUUID() + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1", "sa", "");
        try (var connection = source.getConnection()) {
            ScriptUtils.executeSqlScript(connection, new ClassPathResource("operations/enterprise-storage.sql"));
        }
        Configuration configuration = new Configuration(new Environment("test", new JdbcTransactionFactory(), source));
        configuration.addMapper(EnterpriseStorageMapper.class);
        try (var session = new SqlSessionFactoryBuilder().build(configuration).openSession()) {
            EnterpriseStorageMapper mapper = session.getMapper(EnterpriseStorageMapper.class);
            assertThat(mapper.selectClouds(42)).extracting(cloud -> cloud.getProjectId())
                .containsExactly(1L, 2L, 6L, 8L);
            assertThat(mapper.selectClouds(42).get(3).getKnCode()).isNull();
            assertThat(mapper.selectClouds(43)).extracting(cloud -> cloud.getProjectId()).containsExactly(3L);
            assertThat(mapper.selectCloudEnterprises(101)).containsExactly(42L);
            assertThat(mapper.selectCloudEnterprises(104)).isEmpty();
            assertThat(mapper.selectCloudEnterprises(105)).isEmpty();
            assertThat(mapper.selectCloudEnterprises(106)).containsExactly(42L);
            assertThat(mapper.commerciallyManaged(42)).isTrue();
            assertThat(mapper.commerciallyManaged(43)).isFalse();
            assertThat(mapper.canRead(42, 7)).isTrue();
            assertThat(mapper.canRead(43, 7)).isFalse();
            assertThat(mapper.canRead(42, 8)).isFalse();
            assertThat(mapper.canRead(42, 9)).isFalse();
            assertThat(mapper.canRead(43, 10)).isTrue();
            assertThat(mapper.canRead(42, 11)).isFalse();
            assertThat(mapper.canRead(42, 12)).isFalse();
        }
    }
}
