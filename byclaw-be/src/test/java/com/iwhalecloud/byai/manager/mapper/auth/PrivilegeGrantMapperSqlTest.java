package com.iwhalecloud.byai.manager.mapper.auth;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.apache.ibatis.scripting.xmltags.XMLLanguageDriver;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.Test;

/** 校验审核中心查询为前端历史列表提供稳定的审核结果和处理时间字段。 */
class PrivilegeGrantMapperSqlTest {

    @Test
    void resourceListQuery_excludesDeregisteredRowsBeforePaginationForBothOwners() throws IOException {
        try (var input = getClass().getResourceAsStream(
            "/com/iwhalecloud/byai/manager/mapper/auth/PrivilegeGrantMapper.xml")) {
            assertThat(input).isNotNull();
            String xml = new String(input.readAllBytes(), StandardCharsets.UTF_8);
            int start = xml.indexOf("<select id=\"listResourceAuth\"");
            String query = xml.substring(start, xml.indexOf("</select>", start));
            var source = new XMLLanguageDriver().createSqlSource(new Configuration(),
                "<script>" + query.substring(query.indexOf('>') + 1) + "</script>", Map.class);
            Map<String, Object> params = new HashMap<>();
            params.put("userId", 2L);
            params.put("defaultPersonalResourceId", 10L);
            for (String owner : List.of("personal", "enterprise")) {
                params.put("ownerType", owner);
                for (String status : List.of("", "0", "2", "3", "-1")) {
                    params.put("resourceStatus", status);
                    params.put("excludeDeleted", true);
                    String sql = source.getBoundSql(params).getSql().replaceAll("\\s+", " ");
                    // 条件在 OR 组外，包含默认个人资源和全部状态时也不能返回注销数据。
                    assertThat(sql).contains("WHERE a.resource_status != -1 and (");
                    params.put("excludeDeleted", false);
                    assertThat(source.getBoundSql(params).getSql()).doesNotContain("a.resource_status != -1");
                }
            }
        }
    }

    @Test
    void digitalEmployeeAuditQuery_exposesProcessedResultAndTimeForHistory() throws IOException {
        String resourcePath = "/com/iwhalecloud/byai/manager/mapper/auth/PrivilegeGrantMapper.xml";
        try (var input = getClass().getResourceAsStream(resourcePath)) {
            assertThat(input).isNotNull();
            String mapperXml = new String(input.readAllBytes(), StandardCharsets.UTF_8);
            int queryStart = mapperXml.indexOf("<select id=\"queryDigitalEmployeeUseApplyAudit\"");
            int queryEnd = mapperXml.indexOf("</select>", queryStart);
            assertThat(queryStart).isGreaterThanOrEqualTo(0);
            assertThat(queryEnd).isGreaterThan(queryStart);

            String query = mapperXml.substring(queryStart, queryEnd);
            assertThat(query).contains("pg.update_date as auditTime")
                .contains("pg.update_staff as auditUserId")
                .contains("coalesce(auditor.user_name, cast(pg.update_staff as varchar)) as auditUserName")
                .contains("when pg.status_cd = 'X' then '审核通过'")
                .contains("when pg.status_cd = 'R' then '已驳回'")
                .contains("left join po_users auditor on auditor.user_id = pg.update_staff")
                .contains("and pg.status_cd in ('X', 'R')")
                .contains("resourceBizTypeList")
                .contains("r.resource_biz_type in");
        }
    }

    @Test
    void resourceListQuery_supportsManageableAndManagedScopes() throws IOException {
        String resourcePath = "/com/iwhalecloud/byai/manager/mapper/auth/PrivilegeGrantMapper.xml";
        try (var input = getClass().getResourceAsStream(resourcePath)) {
            assertThat(input).isNotNull();
            String mapperXml = new String(input.readAllBytes(), StandardCharsets.UTF_8);
            int queryStart = mapperXml.indexOf("<select id=\"listResourceAuth\"");
            int queryEnd = mapperXml.indexOf("</select>", queryStart);
            assertThat(queryStart).isGreaterThanOrEqualTo(0);
            assertThat(queryEnd).isGreaterThan(queryStart);

            String query = mapperXml.substring(queryStart, queryEnd);
            assertThat(query).contains("permission == 'MANAGEABLE_BY_ME'")
                .contains("permission == 'MANAGED_BY_ME'")
                .contains("k.allow_manage_count > 0");

            String script = "<script>" + query.substring(query.indexOf('>') + 1) + "</script>";
            var source = new XMLLanguageDriver().createSqlSource(new Configuration(), script, Map.class);
            Map<String, Object> params = new HashMap<>();
            params.put("userId", 2L);
            params.put("ownerType", "enterprise");
            params.put("managerOrgPathCodes", List.of("-1.100"));
            // 即使有全局/组织管理角色，这两个列表范围也只能由本人创建或明确管理授权决定。
            for (boolean platformManager : List.of(false, true)) {
                params.put("platformManager", platformManager);
                for (String permission : List.of("MANAGEABLE_BY_ME", "MANAGED_BY_ME")) {
                    params.put("permission", permission);
                    String sql = source.getBoundSql(params).getSql().replaceAll("\\s+", " ");
                    assertThat(sql).doesNotContain("or 1 = 1").doesNotContain("org.path_code");
                    if ("MANAGEABLE_BY_ME".equals(permission)) {
                        assertThat(sql).contains("and ( a.create_by = ? or k.allow_manage_count > 0 )");
                    } else {
                        assertThat(sql).contains("and (a.create_by is null or a.create_by != ?)")
                            .contains("and ( k.allow_manage_count > 0 )");
                    }
                }
            }
        }
    }
}
