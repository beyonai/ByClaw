package com.iwhalecloud.byai.manager.qo.session;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.InputStream;

import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMapper;
import com.iwhalecloud.byai.manager.qo.devloop.ProjectSessionQo;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.mapping.BoundSql;
import org.apache.ibatis.mapping.MappedStatement;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.Test;

class ByaiSessionHierarchyQueryTest {

    @Test
    void defaultConversationQueryOnlyReturnsRootSessions() {
        String sql = normalizeSql(resolveSql(new ByaiSessionQo()));

        assertThat(sql).contains("a.parent_session_id IS NULL");
    }

    @Test
    void parentConversationQueryReturnsOnlyItsDirectChildren() {
        ByaiSessionQo qo = new ByaiSessionQo();
        qo.setParentSessionId(100L);

        String sql = normalizeSql(resolveSql(qo));

        assertThat(sql)
            .contains("a.parent_session_id = ?")
            .doesNotContain("a.parent_session_id IS NULL");
    }

    @Test
    void exactConversationQueryCanOpenAChildWithoutSidebarFiltering() {
        ByaiSessionQo qo = new ByaiSessionQo();
        qo.setSessionId(200L);

        String sql = normalizeSql(resolveSql(qo));

        assertThat(sql)
            .contains("a.session_id = ?")
            .doesNotContain("a.parent_session_id IS NULL");
    }

    @Test
    void projectConversationQueryOnlyReturnsRootSessions() {
        ProjectSessionQo qo = new ProjectSessionQo();
        qo.setProjectId(300L);

        String sql = normalizeSql(resolveProjectSql(qo));

        assertThat(sql).contains("a.parent_session_id IS NULL");
    }

    private String resolveSql(ByaiSessionQo qo) {
        Configuration configuration = mapperConfiguration();
        MappedStatement statement = configuration.getMappedStatement(
            ByaiSessionMapper.class.getName() + ".qryConversations"
        );
        BoundSql boundSql = statement.getBoundSql(qo);
        return boundSql.getSql();
    }

    private String resolveProjectSql(ProjectSessionQo qo) {
        Configuration configuration = mapperConfiguration();
        MappedStatement statement = configuration.getMappedStatement(
            ByaiSessionMapper.class.getName() + ".selectSessionsByProjectByQo"
        );
        BoundSql boundSql = statement.getBoundSql(qo);
        return boundSql.getSql();
    }

    private Configuration mapperConfiguration() {
        Configuration configuration = new Configuration();
        String resource = "com/iwhalecloud/byai/manager/mapper/session/ByaiSessionMapper.xml";
        try (InputStream inputStream = getClass().getClassLoader().getResourceAsStream(resource)) {
            assertThat(inputStream).as("mapper resource").isNotNull();
            XMLMapperBuilder mapperBuilder = new XMLMapperBuilder(
                inputStream,
                configuration,
                resource,
                configuration.getSqlFragments()
            );
            mapperBuilder.parse();
        }
        catch (Exception e) {
            throw new IllegalStateException("Unable to parse session mapper", e);
        }
        return configuration;
    }

    private String normalizeSql(String sql) {
        return sql.replaceAll("\\s+", " ").trim();
    }
}
