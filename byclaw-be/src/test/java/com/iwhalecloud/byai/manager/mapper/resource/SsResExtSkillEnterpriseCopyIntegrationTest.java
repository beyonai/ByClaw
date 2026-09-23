package com.iwhalecloud.byai.manager.mapper.resource;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.sql.DriverManager;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class SsResExtSkillEnterpriseCopyIntegrationTest {
    @TempDir
    Path tempDir;

    @Test
    void copyLookupIncludesOffShelfAndReplacementButExcludesRemovedAndUnrelatedCopies() throws Exception {
        String url = "jdbc:sqlite:" + tempDir.resolve("enterprise-copies.sqlite");
        try (var connection = DriverManager.getConnection(url); var sql = connection.createStatement()) {
            sql.execute("CREATE TABLE ss_resource (resource_id INTEGER PRIMARY KEY, resource_code TEXT, "
                + "resource_biz_type TEXT, owner_type TEXT, resource_status INTEGER)");
            sql.execute("CREATE TABLE ss_res_ext_skill (resource_id INTEGER PRIMARY KEY, target_content TEXT)");
            // 同一来源的注销旧副本和下架新副本同时存在时，仍必须隐藏入口。
            sql.execute("INSERT INTO ss_resource VALUES "
                + "(1, 'enterprise-skill-601', 'SKILL', 'enterprise', -1),"
                + "(2, 'enterprise-skill-601-2', 'SKILL', 'enterprise', 3),"
                + "(3, 'enterprise-skill-602', 'SKILL', 'enterprise', 2),"
                + "(4, 'enterprise-skill-603', 'SKILL', 'enterprise', -1),"
                + "(5, 'enterprise-skill-6010', 'SKILL', 'enterprise', 2),"
                + "(6, 'enterprise-skill-601-3', 'SKILL', 'personal', 2),"
                + "(7, 'enterprise-skill-601-4', 'TOOLKIT', 'enterprise', 2),"
                + "(8, 'enterprise-skill-604', 'SKILL', 'enterprise', 1)");
            sql.execute("INSERT INTO ss_res_ext_skill(resource_id) VALUES (1),(2),(3),(4),(5),(6),(7),(8),(9)");
        }
        var environment = new Environment("sqlite-test", new JdbcTransactionFactory(),
            new UnpooledDataSource("org.sqlite.JDBC", url, null, null));
        var configuration = new MybatisConfiguration(environment);
        configuration.addMapper(SsResourceMapper.class);
        configuration.addMapper(SsResExtSkillMapper.class);
        try (var session = new SqlSessionFactoryBuilder().build(configuration).openSession()) {
            var mapper = session.getMapper(SsResExtSkillMapper.class);
            assertThat(mapper.findExistingEnterpriseCopies(List.of(601L, 602L, 603L, 604L)))
                .extracting("resourceId").containsExactlyInAnyOrder(2L, 3L, 8L);
            assertThat(mapper.findExistingEnterpriseCopies(List.of(603L))).isEmpty();
            // 物理删除资源后，即使残留扩展记录，也不再占用入口。
            try (var sql = session.getConnection().createStatement()) {
                sql.execute("DELETE FROM ss_resource WHERE resource_id = 2");
            }
            session.clearCache();
            assertThat(mapper.findExistingEnterpriseCopies(List.of(601L))).isEmpty();
        }
    }
}
