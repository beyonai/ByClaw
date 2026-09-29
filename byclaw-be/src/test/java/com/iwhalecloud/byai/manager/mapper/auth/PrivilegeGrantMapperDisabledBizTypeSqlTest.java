package com.iwhalecloud.byai.manager.mapper.auth;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.apache.ibatis.scripting.xmltags.XMLLanguageDriver;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.Test;

/**
 * 入口 1 {@code listResourceUseAuth} 的停用类型排除为「无条件下发」的绑定 SQL 断言。
 *
 * <p>覆盖 AC-001 / AC-005：未传类型、混合类型、显式只传停用类型三种入参都必须下发同一条排除条件，
 * 否则分页 count 与 select 的结果集语义会随入参漂移。
 */
class PrivilegeGrantMapperDisabledBizTypeSqlTest {

    /** 排除条件（紧凑形态）：MyBatis 展开后的占位符之间会带空白，断言前统一压缩。 */
    private static final String EXCLUSION = "upper(trim(a.resource_biz_type)) not in (?,?,?,?)";

    @Test
    void exclusionIsEmittedForEmptyMixedAndExplicitDisabledTypes() throws IOException {
        var source = listResourceAuthSqlSource();
        List<List<String>> requestShapes = new ArrayList<>();
        requestShapes.add(null);
        requestShapes.add(List.of());
        requestShapes.add(List.of("KG_DOC"));
        requestShapes.add(List.of("OBJECT"));
        requestShapes.add(List.of("KG_DOC", "OBJECT"));
        requestShapes.add(List.of("SCENE", "ONTOLOGY_BASE", "VIEW"));

        for (List<String> bizTypes : requestShapes) {
            for (String owner : List.of("personal", "enterprise")) {
                Map<String, Object> params = baseParams(owner);
                params.put("resourceBizTypeList", bizTypes);
                String sql = source.getBoundSql(params).getSql().replaceAll("\\s+", " ");
                assertThat(compact(sql))
                    .as("resourceBizTypeList=%s owner=%s", bizTypes, owner)
                    .contains(EXCLUSION);
                // NULL 类型的历史行不得被静默排除（裸 not in 会连 NULL 行一起丢掉）。
                assertThat(sql).contains("a.resource_biz_type is null");
            }
        }
    }

    @Test
    void exclusionBindsExactlyTheFourDisabledTypes() throws IOException {
        var source = listResourceAuthSqlSource();
        Map<String, Object> params = baseParams("enterprise");
        params.put("resourceBizTypeList", null);
        var boundSql = source.getBoundSql(params);
        assertThat(compact(boundSql.getSql())).contains(EXCLUSION);

        List<Object> disabledValues = new ArrayList<>();
        boundSql.getParameterMappings().forEach(mapping -> {
            if (mapping.getProperty() != null && mapping.getProperty().startsWith("__frch_disabledBizType")) {
                disabledValues.add(boundSql.getAdditionalParameter(mapping.getProperty()));
            }
        });
        assertThat(disabledValues).containsExactlyInAnyOrder("OBJECT", "VIEW", "ONTOLOGY_BASE", "SCENE");
    }

    @Test
    void xmlCarriesNoDisabledTypeLiteralList() throws IOException {
        try (var input = getClass().getResourceAsStream(
            "/com/iwhalecloud/byai/manager/mapper/auth/PrivilegeGrantMapper.xml")) {
            assertThat(input).isNotNull();
            String xml = new String(input.readAllBytes(), StandardCharsets.UTF_8);
            int start = xml.indexOf("<select id=\"listResourceAuth\"");
            String query = xml.substring(start, xml.indexOf("</select>", start));
            assertThat(query).contains("DisabledResourceBizTypes@codes()")
                .doesNotContain("'OBJECT'")
                .doesNotContain("'VIEW'");
        }
    }

    /** 压缩空白，使 MyBatis 展开后的 SQL 可做稳定的字面量断言。 */
    private static String compact(String sql) {
        return sql.replaceAll("\\s+", " ")
            .replaceAll("\\(\\s+", "(")
            .replaceAll("\\s+\\)", ")")
            .replaceAll("\\s*,\\s*", ",");
    }

    private static org.apache.ibatis.mapping.SqlSource listResourceAuthSqlSource() throws IOException {
        try (var input = PrivilegeGrantMapperDisabledBizTypeSqlTest.class.getResourceAsStream(
            "/com/iwhalecloud/byai/manager/mapper/auth/PrivilegeGrantMapper.xml")) {
            assertThat(input).isNotNull();
            String xml = new String(input.readAllBytes(), StandardCharsets.UTF_8);
            int start = xml.indexOf("<select id=\"listResourceAuth\"");
            String query = xml.substring(start, xml.indexOf("</select>", start));
            return new XMLLanguageDriver().createSqlSource(new Configuration(),
                "<script>" + query.substring(query.indexOf('>') + 1) + "</script>", Map.class);
        }
    }

    private static Map<String, Object> baseParams(String ownerType) {
        Map<String, Object> params = new HashMap<>();
        params.put("userId", 2L);
        params.put("defaultPersonalResourceId", 10L);
        params.put("ownerType", ownerType);
        params.put("resourceStatus", "2");
        params.put("excludeDeleted", true);
        return params;
    }
}
