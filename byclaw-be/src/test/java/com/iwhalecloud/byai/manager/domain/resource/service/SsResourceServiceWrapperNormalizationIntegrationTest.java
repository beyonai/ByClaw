package com.iwhalecloud.byai.manager.domain.resource.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import com.baomidou.mybatisplus.core.conditions.AbstractWrapper;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.manager.qo.resource.ResourceQo;

/**
 * 入口 5 {@code /open/api/v1/getUserAuthResource} 的 MyBatis-Plus wrapper 在**真实 SQL** 上的归一化对照用例。
 *
 * <p>覆盖 AC-003 与评审缺陷 F-1 的回归：捕获 {@code selectResourceByQo} 真实下发的 wrapper，取其
 * {@code getSqlSegment()} 与参数值还原为可执行谓词，与 5 处 XML 入口的
 * {@code (col is null or upper(trim(col)) not in (...))} 谓词在**同一张表、同一份数据**上对照执行，
 * 断言两者给出**完全相同的结果集**：小写 / 首尾空白 / 混合大小写变体与规范大写一并被排除，
 * {@code resource_biz_type IS NULL} 的历史行与伪造类型（{@code OBJECTX}）、未核实别名（{@code ontology}）不被误伤。
 *
 * <p>方言说明：SQLite 与 PostgreSQL 对文本列的 {@code NOT IN} 均大小写敏感，且 SQLite 的 {@code trim()}
 * 默认仅去空格（不含 tab/换行），与 PostgreSQL 的 {@code trim()} 语义一致，故此处的同数据对照有效。
 */
class SsResourceServiceWrapperNormalizationIntegrationTest {

    /** 停用类型规范码，与 {@code DisabledResourceBizTypes.codes()} 一致。 */
    private static final String XML_STYLE_PREDICATE =
        "(resource_biz_type is null or upper(trim(resource_biz_type)) not in "
            + "('OBJECT','VIEW','ONTOLOGY_BASE','SCENE'))";

    @TempDir
    Path tempDir;

    @Test
    void wrapperPredicateMatchesXmlStylePredicateOnVariantData() throws Exception {
        String jdbcUrl = "jdbc:sqlite:" + tempDir.resolve("entry5-normalization.sqlite").toAbsolutePath();
        initializeSchema(jdbcUrl);

        SsResourceMapper ssResourceMapper = org.mockito.Mockito.mock(SsResourceMapper.class);
        when(ssResourceMapper.selectPage(any(), any())).thenReturn(new Page<>());
        SsResourceService service = new SsResourceService();
        ReflectionTestUtils.setField(service, "ssResourceMapper", ssResourceMapper);

        service.selectResourceByQo(new ResourceQo());

        ArgumentCaptor<Wrapper<SsResource>> captor = ArgumentCaptor.forClass(Wrapper.class);
        verify(ssResourceMapper).selectPage(any(), captor.capture());
        AbstractWrapper<SsResource, ?, ?> wrapper = (AbstractWrapper<SsResource, ?, ?>) captor.getValue();

        String segment = wrapper.getSqlSegment();
        String executable = bindParams(segment, wrapper.getParamNameValuePairs());

        System.out.println("[F-1-EVIDENCE] entry5 wrapper sqlSegment = " + segment);
        System.out.println("[F-1-EVIDENCE] entry5 executable predicate = " + executable);

        List<Long> wrapperResult = selectResourceIds(jdbcUrl, executable);
        List<Long> xmlStyleResult = selectResourceIds(jdbcUrl, XML_STYLE_PREDICATE);

        System.out.println("[F-1-EVIDENCE] entry5 wrapper result       = " + wrapperResult);
        System.out.println("[F-1-EVIDENCE] xml-style predicate result  = " + xmlStyleResult);

        // 归一化形态：与 5 处 XML 入口一致（评审 F-1 的修复目标）。
        assertThat(segment).contains("upper(trim(resource_biz_type)) not in")
            .doesNotContain("resource_biz_type NOT IN");

        // 两种形态在同数据上结果集完全相同 —— 大小写/空白变体一律排除，NULL 与伪造类型保留。
        assertThat(wrapperResult).isEqualTo(xmlStyleResult);
        assertThat(wrapperResult).containsExactly(500L, 506L, 507L, 512L, 513L);
        assertThat(wrapperResult).doesNotContain(501L, 502L, 503L, 504L, 505L, 508L, 509L, 510L, 511L);
    }

    /** 把 MyBatis-Plus 的 {@code #{ew.paramNameValuePairs.XXX}} 占位符还原为字面量，便于在 SQLite 上对照执行。 */
    private static String bindParams(String segment, Map<String, Object> params) {
        Matcher matcher = Pattern.compile("#\\{ew\\.paramNameValuePairs\\.([A-Za-z0-9_]+)}").matcher(segment);
        StringBuilder out = new StringBuilder();
        while (matcher.find()) {
            Object value = params.get(matcher.group(1));
            String literal = value instanceof Number ? String.valueOf(value) : "'" + value + "'";
            matcher.appendReplacement(out, Matcher.quoteReplacement(literal));
        }
        matcher.appendTail(out);
        return out.toString();
    }

    private static List<Long> selectResourceIds(String jdbcUrl, String predicate) throws Exception {
        List<Long> ids = new ArrayList<>();
        try (Connection connection = DriverManager.getConnection(jdbcUrl);
            Statement statement = connection.createStatement();
            ResultSet rs = statement.executeQuery(
                "SELECT resource_id FROM ss_resource WHERE " + predicate + " ORDER BY resource_id")) {
            while (rs.next()) {
                ids.add(rs.getLong(1));
            }
        }
        return ids;
    }

    private static void initializeSchema(String jdbcUrl) throws Exception {
        try (Connection connection = DriverManager.getConnection(jdbcUrl);
            Statement statement = connection.createStatement()) {
            statement.execute("""
                CREATE TABLE ss_resource (
                    resource_id INTEGER PRIMARY KEY,
                    resource_biz_type TEXT,
                    resource_name TEXT,
                    resource_code TEXT,
                    resource_status INTEGER
                )
                """);
            statement.execute("""
                INSERT INTO ss_resource(resource_id, resource_biz_type, resource_name, resource_code, resource_status)
                VALUES (500,'KG_DOC',       '正常文档',        'code-500',2),
                       (501,'object',       '小写对象',        'code-501',2),
                       (502,' OBJECT ',     '带空白对象',      'code-502',2),
                       (503,'view',         '小写视图',        'code-503',2),
                       (504,'Scene',        '混合大小写场景',  'code-504',2),
                       (505,'ontology_base','小写本体',        'code-505',2),
                       (506,'OBJECTX',      '伪造类型',        'code-506',2),
                       (507,NULL,           '无类型历史行',    'code-507',2),
                       (508,'OBJECT',       '规范对象',        'code-508',2),
                       (509,'VIEW',         '规范视图',        'code-509',2),
                       (510,'SCENE',        '规范场景',        'code-510',2),
                       (511,'ONTOLOGY_BASE','规范本体',        'code-511',2),
                       (512,'ontology',     '别名候选(未核实)', 'code-512',2),
                       (513,'KG_DOC',       '正常文档2',       'code-513',2)
                """);
        }
    }
}
