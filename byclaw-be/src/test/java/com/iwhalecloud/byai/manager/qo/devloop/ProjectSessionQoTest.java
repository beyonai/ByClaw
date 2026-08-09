package com.iwhalecloud.byai.manager.qo.devloop;

import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMapper;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.mapping.BoundSql;
import org.apache.ibatis.mapping.MappedStatement;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.Test;

import java.io.InputStream;

import static org.assertj.core.api.Assertions.assertThat;

class ProjectSessionQoTest {

    @Test
    void normalizeSearchCondition_enablesChatContentSearchAndEscapesLikeWildcards() {
        ProjectSessionQo qo = new ProjectSessionQo();
        qo.setKeyword("  Plan%_\\  ");
        qo.setSearchMode("chat_content");

        qo.normalizeSearchCondition();

        assertThat(qo.getKeyword()).isEqualTo("Plan%_\\");
        assertThat(qo.getKeywordLike()).isEqualTo("Plan\\%\\_\\\\");
        assertThat(qo.isChatContentSearch()).isTrue();
        assertThat(qo.isDigitalEmployeeSearch()).isFalse();
    }

    @Test
    void normalizeSearchCondition_enablesDigitalEmployeeSearchOnlyWhenKeywordPresent() {
        ProjectSessionQo qo = new ProjectSessionQo();
        qo.setKeyword("  产品经理  ");
        qo.setSearchMode("DIGITAL_EMPLOYEE");

        qo.normalizeSearchCondition();

        assertThat(qo.isDigitalEmployeeSearch()).isTrue();
        assertThat(qo.isChatContentSearch()).isFalse();

        qo.setKeyword("  ");
        qo.normalizeSearchCondition();

        assertThat(qo.getKeyword()).isNull();
        assertThat(qo.isDigitalEmployeeSearch()).isFalse();
    }

    @Test
    void normalizeSearchCondition_fallsBackToLegacySearchForUnknownMode() {
        ProjectSessionQo qo = new ProjectSessionQo();
        qo.setKeyword("release plan");
        qo.setSearchMode("unsupported");

        qo.normalizeSearchCondition();

        assertThat(qo.getSearchMode()).isNull();
        assertThat(qo.isDigitalEmployeeSearch()).isFalse();
        assertThat(qo.isChatContentSearch()).isFalse();
    }

    @Test
    void projectSessionMapper_generatesDedicatedSqlForBothAdvancedSearchModes() {
        ProjectSessionQo employeeSearch = new ProjectSessionQo();
        employeeSearch.setProjectId(1L);
        employeeSearch.setKeyword("产品经理");
        employeeSearch.setSearchMode(ProjectSessionQo.SEARCH_MODE_DIGITAL_EMPLOYEE);
        employeeSearch.normalizeSearchCondition();

        String employeeSql = normalizeSql(resolveProjectSessionSql(employeeSearch));
        assertThat(employeeSql)
            .contains("EXISTS ( SELECT 1 FROM ss_resource employee")
            .contains("member.mem_obj_type = 'AGENT'")
            .contains("AS matched_employee_name")
            .contains("AS matched_employee_match_field")
            .contains("AS matched_employee_match_text")
            .contains("THEN 'NAME'")
            .contains("ELSE 'DESCRIPTION'")
            .doesNotContain("LATERAL")
            .doesNotContain("LOWER(a.session_name) LIKE");

        ProjectSessionQo chatSearch = new ProjectSessionQo();
        chatSearch.setProjectId(1L);
        chatSearch.setKeyword("合同");
        chatSearch.setSearchMode(ProjectSessionQo.SEARCH_MODE_CHAT_CONTENT);
        chatSearch.normalizeSearchCondition();

        String chatSql = normalizeSql(resolveProjectSessionSql(chatSearch));
        assertThat(chatSql)
            .contains("FROM byai_message message")
            .contains("message.archived_at IS NULL")
            .contains("message.\"usage\" IN (1, 2)")
            .contains("AS match_text")
            .doesNotContain("LOWER(a.session_name) LIKE");
    }

    private String resolveProjectSessionSql(ProjectSessionQo qo) {
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
        } catch (Exception e) {
            throw new IllegalStateException("Unable to parse project session mapper", e);
        }

        MappedStatement statement = configuration.getMappedStatement(
            ByaiSessionMapper.class.getName() + ".selectSessionsByProjectByQo"
        );
        BoundSql boundSql = statement.getBoundSql(qo);
        return boundSql.getSql();
    }

    private String normalizeSql(String sql) {
        return sql.replaceAll("\\s+", " ").trim();
    }
}
