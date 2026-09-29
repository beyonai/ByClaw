package com.iwhalecloud.byai.manager.mapper.resource;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.apache.ibatis.mapping.SqlSource;
import org.apache.ibatis.scripting.xmltags.XMLLanguageDriver;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.manager.dto.resource.ResourceQueryRequest;

/**
 * 入口 2 / 入口 4 的停用类型排除与 {@code parent_resource_id} 豁免语义的绑定 SQL 断言。
 *
 * <p>覆盖 AC-006 / AC-008：排除条件无条件下发；豁免的触发条件由统一规则派生，且 6 组入参矩阵与基线逐行一致。
 */
class SsResourceMapperDisabledBizTypeSqlTest {

    private static final String PAGE_EXCLUSION = "upper(trim(r.resource_biz_type)) not in (?,?,?,?)";
    private static final String REL_AUTH_EXCLUSION = "upper(trim(a.resource_biz_type)) not in (?,?,?,?)";

    @Test
    void getResourceListByPageExclusionIsUnconditional() throws IOException {
        SqlSource source = sqlSource("getResourceListByPage");
        for (ResourceQueryRequest query : requestShapes()) {
            String sql = compact(pageSql(source, query));
            assertThat(sql).as("resourceBizType=%s list=%s", query.getResourceBizType(), query.getResourceBizTypeList())
                .contains(PAGE_EXCLUSION);
            // NULL 类型的历史行不得被静默排除。
            assertThat(sql).contains("r.resource_biz_type is null");
        }
    }

    @Test
    void parentResourceIdExemptionIsRuleDerivedForAllRequestShapes() throws IOException {
        SqlSource source = sqlSource("getResourceListByPage");

        // 与基线逐行一致：仅当请求显式要求停用类型（单个字段或列表）时不下发 parent_resource_id = -1。
        int checkedShapes = 0;
        for (ResourceQueryRequest query : requestShapes()) {
            boolean expectsDisabledRequest = isDisabledRequest(query);
            boolean hasParentCondition = compact(pageSql(source, query))
                .contains("r.parent_resource_id = -1");
            assertThat(hasParentCondition)
                .as("resourceBizType=%s list=%s", query.getResourceBizType(), query.getResourceBizTypeList())
                .isEqualTo(!expectsDisabledRequest);
            checkedShapes++;
        }
        assertThat(checkedShapes).isEqualTo(6);
    }

    @Test
    void parentResourceIdExemptionKeepsNullListSafe() throws IOException {
        SqlSource source = sqlSource("getResourceListByPage");
        ResourceQueryRequest query = new ResourceQueryRequest();
        query.setResourceBizType(null);
        query.setResourceBizTypeList(null);
        assertThat(compact(pageSql(source, query))).contains("r.parent_resource_id = -1");
    }

    @Test
    void relResourceAuthExclusionIsUnconditional() throws IOException {
        SqlSource source = sqlSource("queryDigEmployeeRelResourceAuthList");
        List<List<String>> shapes = new ArrayList<>(List.of(List.of(), List.of("SKILL"), List.of("OBJECT"),
            List.of("KG_DOC", "VIEW")));
        for (List<String> bizTypes : shapes) {
            Map<String, Object> params = new HashMap<>();
            params.put("resourceId", 1L);
            params.put("resourceBizTypeList", bizTypes);
            String sql = compact(boundSql(source, params));
            assertThat(sql).as("resourceBizTypeList=%s", bizTypes).contains(REL_AUTH_EXCLUSION);
            assertThat(sql).contains("a.resource_biz_type is null");
        }
    }

    @Test
    void relResourceAuthDefaultListHasNoDisabledTypes() throws IOException {
        String xml = readMapperXml();
        int start = xml.indexOf("<select id=\"queryDigEmployeeRelResourceAuthList\"");
        String select = xml.substring(start, xml.indexOf("</select>", start));
        int otherwise = select.indexOf("<otherwise>");
        String defaultList = select.substring(otherwise, select.indexOf("</otherwise>", otherwise));
        assertThat(defaultList).contains("'KG_DOC'", "'KG_QA'", "'TOOLKIT'", "'MCP'", "'AGENT'")
            .doesNotContain("'OBJECT'")
            .doesNotContain("'VIEW'");
    }

    @Test
    void xmlCarriesNoDisabledTypeLiteralListForPageQueries() throws IOException {
        String xml = readMapperXml();
        for (String selectId : List.of("getResourceListByPage", "queryDigEmployeeRelResourceAuthList")) {
            int start = xml.indexOf("<select id=\"" + selectId + "\"");
            String select = xml.substring(start, xml.indexOf("</select>", start));
            assertThat(select).as(selectId)
                .contains("DisabledResourceBizTypes@codes()")
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

    private static boolean isDisabledRequest(ResourceQueryRequest query) {
        String single = query.getResourceBizType();
        boolean singleDisabled = single != null && List.of("OBJECT", "VIEW", "ONTOLOGY_BASE", "SCENE")
            .contains(single.trim().toUpperCase());
        List<String> list = query.getResourceBizTypeList();
        boolean listDisabled = list != null && list.stream()
            .anyMatch(value -> value != null && List.of("OBJECT", "VIEW", "ONTOLOGY_BASE", "SCENE")
                .contains(value.trim().toUpperCase()));
        return singleDisabled || listDisabled;
    }

    /** 6 组入参矩阵，对齐设计 Spike #2 与基线行为。 */
    private static List<ResourceQueryRequest> requestShapes() {
        List<ResourceQueryRequest> shapes = new ArrayList<>();
        shapes.add(request(null, new ArrayList<>()));
        shapes.add(request("KG_DOC", new ArrayList<>()));
        shapes.add(request("OBJECT", new ArrayList<>()));
        shapes.add(request(null, new ArrayList<>(Arrays.asList("KG_DOC", "OBJECT"))));
        shapes.add(request(null, new ArrayList<>(List.of("KG_DOC"))));
        shapes.add(request(null, null));
        return shapes;
    }

    private static ResourceQueryRequest request(String resourceBizType, List<String> resourceBizTypeList) {
        ResourceQueryRequest query = new ResourceQueryRequest();
        query.setResourceBizType(resourceBizType);
        query.setResourceBizTypeList(resourceBizTypeList);
        query.setResourceTypeList(new ArrayList<>());
        return query;
    }

    private static String boundSql(SqlSource source, Object params) {
        return source.getBoundSql(params).getSql();
    }

    /** 页面查询的 mapper 参数为 {@code @Param("query")}，绑定断言必须保持同名包装。 */
    private static String pageSql(SqlSource source, ResourceQueryRequest query) {
        Map<String, Object> params = new HashMap<>();
        params.put("query", query);
        return boundSql(source, params);
    }

    private static SqlSource sqlSource(String selectId) throws IOException {
        String xml = readMapperXml();
        int start = xml.indexOf("<select id=\"" + selectId + "\"");
        String select = xml.substring(start, xml.indexOf("</select>", start));
        return new XMLLanguageDriver().createSqlSource(new Configuration(),
            "<script>" + select.substring(select.indexOf('>') + 1) + "</script>", Object.class);
    }

    private static String readMapperXml() throws IOException {
        try (var input = SsResourceMapperDisabledBizTypeSqlTest.class.getResourceAsStream(
            "/com/iwhalecloud/byai/manager/mapper/resource/SsResourceMapper.xml")) {
            assertThat(input).isNotNull();
            return new String(input.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
}
