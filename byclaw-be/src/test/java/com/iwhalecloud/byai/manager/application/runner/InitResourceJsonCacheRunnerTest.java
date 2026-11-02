package com.iwhalecloud.byai.manager.application.runner;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.MybatisSqlSessionFactoryBuilder;
import com.iwhalecloud.byai.manager.mapper.resource.ResourceJsonCacheMapper;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceJsonCacheService;
import java.util.UUID;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

class InitResourceJsonCacheRunnerTest {
    @Test void backfillsPersistedJsonAcrossSourcesAndCleansUnavailableResourcesUsingKeysetPages() {
        var ds = new DriverManagerDataSource("jdbc:h2:mem:" + UUID.randomUUID()
            + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1;INIT=CREATE SCHEMA IF NOT EXISTS byai\\;SET SCHEMA byai");
        var jdbc = new JdbcTemplate(ds);
        jdbc.execute("CREATE TABLE ss_resource(resource_id BIGINT PRIMARY KEY, resource_biz_type VARCHAR(30), resource_status INT)");
        for (String table : new String[]{"skill", "tool", "toolkit", "mcp", "agent", "object", "view", "doc"}) {
            jdbc.execute("CREATE TABLE ss_res_ext_" + table + "(resource_id BIGINT PRIMARY KEY, target_content TEXT)");
        }
        jdbc.update("INSERT INTO ss_resource VALUES(1,'SKILL',2),(2,'TOOLKIT',2),(3,'KG_DOC',2),(4,'SKILL',3),(5,'KG_DOC',-1)");
        jdbc.update("INSERT INTO ss_res_ext_skill VALUES(1,'{\"local\":true}'),(4,'{}')");
        jdbc.update("INSERT INTO ss_res_ext_toolkit VALUES(2,'{\"remote\":true}')");
        jdbc.update("INSERT INTO ss_res_ext_doc VALUES(3,'{\"knowledge\":true}'),(5,'{}')");
        var config = new MybatisConfiguration();
        config.setMapUnderscoreToCamelCase(true);
        config.setEnvironment(new Environment("test", new JdbcTransactionFactory(), ds));
        config.addMapper(ResourceJsonCacheMapper.class);
        try (var session = new MybatisSqlSessionFactoryBuilder().build(config).openSession()) {
            var mapper = session.getMapper(ResourceJsonCacheMapper.class);
            assertThat(mapper.page(2, 2)).extracting(ResourceJsonCacheMapper.Entry::getResourceId).containsExactly(3L, 4L);
            var cache = mock(ResourceJsonCacheService.class);
            new InitResourceJsonCacheRunner(mapper, cache).run(null);
            verify(cache).putAfterCommit("SKILL", 1, "{\"local\":true}");
            verify(cache).putAfterCommit("TOOLKIT", 2, "{\"remote\":true}");
            verify(cache).putAfterCommit("KG_DOC", 3, "{\"knowledge\":true}");
            verify(cache).removeAfterCommit("SKILL", 4);
            verify(cache).removeAfterCommit("KG_DOC", 5);
            verifyNoMoreInteractions(cache);
        }
    }
}
