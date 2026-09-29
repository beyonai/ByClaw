package com.iwhalecloud.byai.manager.mapper.resource;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.apache.ibatis.mapping.SqlSource;
import org.apache.ibatis.scripting.xmltags.XMLLanguageDriver;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.manager.qo.resource.CatalogDto;

/**
 * 入口 12 / 入口 13 的绑定 SQL 断言。
 *
 * <p>覆盖 AC-013：目录资源列表无条件排除停用类型；目录树的资源节点类型由规则派生参数驱动，
 * 空列表时有 {@code AND 1 = 0} 保护，且 XML 中不再出现 {@code 'OBJECT'} 硬编码。
 */
class SsResourceCatalogMapperDisabledBizTypeSqlTest {

    private static final String EXCLUSION = "upper(trim(a.resource_biz_type)) not in (?,?,?,?)";

    @Test
    void catalogResourceListExclusionIsUnconditional() throws IOException {
        SqlSource source = sqlSource("queryResourceListByCatalogId");
        List<List<String>> bizTypeShapes = new ArrayList<>();
        bizTypeShapes.add(List.of());
        bizTypeShapes.add(List.of("OBJECT"));
        for (Boolean isQueryParent : new Boolean[] {null, Boolean.TRUE, Boolean.FALSE}) {
            for (List<String> bizTypes : bizTypeShapes) {
                CatalogDto catalogDto = new CatalogDto();
                catalogDto.setIsQueryParent(isQueryParent);
                catalogDto.setResourceBizTypeList(bizTypes);
                Map<String, Object> params = new HashMap<>();
                params.put("catalogDto", catalogDto);
                String sql = compact(source.getBoundSql(params).getSql());
                assertThat(sql).as("isQueryParent=%s bizTypes=%s", isQueryParent, bizTypes)
                    .contains(EXCLUSION);
                assertThat(sql).contains("a.resource_biz_type is null");
            }
        }
    }

    @Test
    void catalogTreeUsesRuleDerivedTypesAndEmptyGuard() throws IOException {
        SqlSource source = sqlSource("queryResourceCatalogTree");
        Map<String, Object> params = new HashMap<>();
        params.put("catalogType", 6);
        params.put("resourceNodeBizTypes", List.of());
        String emptySql = source.getBoundSql(params).getSql().replaceAll("\\s+", " ");
        assertThat(emptySql).contains("AND 1 = 0").doesNotContain("r.resource_biz_type IN");

        params.put("resourceNodeBizTypes", List.of("OBJECT"));
        String objectSql = source.getBoundSql(params).getSql().replaceAll("\\s+", " ");
        assertThat(objectSql).contains("r.resource_biz_type IN").doesNotContain("AND 1 = 0");

        params.put("resourceNodeBizTypes", null);
        String nullSql = source.getBoundSql(params).getSql().replaceAll("\\s+", " ");
        assertThat(nullSql).contains("AND 1 = 0");
    }

    @Test
    void xmlNoLongerHardCodesObjectResourceNodes() throws IOException {
        String xml = readMapperXml();
        assertThat(xml).doesNotContain("r.resource_biz_type = 'OBJECT'");
        int start = xml.indexOf("<select id=\"queryResourceListByCatalogId\"");
        String select = xml.substring(start, xml.indexOf("</select>", start));
        assertThat(select).contains("DisabledResourceBizTypes@codes()")
            .doesNotContain("'OBJECT'")
            .doesNotContain("'VIEW'");
    }

    /** 压缩空白，使 MyBatis 展开后的 SQL 可做稳定的字面量断言。 */
    private static String compact(String sql) {
        return sql.replaceAll("\\s+", " ")
            .replaceAll("\\(\\s+", "(")
            .replaceAll("\\s+\\)", ")")
            .replaceAll("\\s*,\\s*", ",");
    }

    private static SqlSource sqlSource(String selectId) throws IOException {
        String xml = readMapperXml();
        int start = xml.indexOf("<select id=\"" + selectId + "\"");
        String select = xml.substring(start, xml.indexOf("</select>", start));
        return new XMLLanguageDriver().createSqlSource(new Configuration(),
            "<script>" + select.substring(select.indexOf('>') + 1) + "</script>", Object.class);
    }

    private static String readMapperXml() throws IOException {
        try (var input = SsResourceCatalogMapperDisabledBizTypeSqlTest.class.getResourceAsStream(
            "/com/iwhalecloud/byai/manager/mapper/resource/SsResourceCatalogMapper.xml")) {
            assertThat(input).isNotNull();
            return new String(input.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
}
