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

/** 校验资源列表的筛选范围，以及审核中心历史列表的结果和处理时间字段。 */
class PrivilegeGrantMapperSqlTest {

    @Test
    void resourceCenterQuery_usesTabSortAndSkipsUnavailableFavorites() throws IOException {
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
            for (List<String> bizTypes : List.of(List.of("SKILL"), List.of("KG_DOC", "KG_QA", "KG_TERM"),
                List.of("TOOLKIT", "MCP", "AGENT"))) {
                params.put("resourceBizTypeList", bizTypes);
                for (boolean includeFavorites : List.of(false, true)) {
                    params.put("includeFavorites", includeFavorites);
                    for (Long tenantId : new Long[] {null, 99L}) {
                        params.put("favoriteTenantId", tenantId);
                        params.put("sortMode", "UPDATED_DESC");
                        String updatedSql = source.getBoundSql(params).getSql().replaceAll("\\s+", " ").trim();
                        assertThat(updatedSql.substring(updatedSql.indexOf("order by")))
                            .isEqualTo("order by coalesce(a.update_time, a.create_time) desc, a.resource_id desc");

                        params.put("sortMode", "POPULARITY_DESC");
                        String popularSql = source.getBoundSql(params).getSql().replaceAll("\\s+", " ").trim();
                        boolean favoritesAvailable = includeFavorites && tenantId != null;
                        assertThat(popularSql.substring(popularSql.indexOf("order by")))
                            .isEqualTo("order by coalesce(uc.use_count, 0) desc, "
                                + (favoritesAvailable ? "coalesce(fc.favorite_count, 0) desc, " : "")
                                + "coalesce(a.update_time, a.create_time) desc, a.resource_id desc");
                        if (!favoritesAvailable) {
                            // 收藏上下文未就绪时不能关联收藏表，也不能在 ORDER BY 中引用 fc。
                            assertThat(popularSql).doesNotContain("byai_resource_favorite")
                                .doesNotContain("fc.favorite_count");
                        }
                    }
                }
            }
        }
    }

    @Test
    void skillConfigurationQuery_combinesAvailableOwnerPermissionAndKeywordFilters() throws IOException {
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
            params.put("resourceBizTypeList", List.of("SKILL"));
            params.put("keyword", "weather");
            params.put("includeAllEnterpriseOwnerType", false);
            params.put("sortByUseCount", true);
            for (String owner : List.of("personal", "enterprise")) {
                params.put("ownerType", owner);
                List<String> permissions = "personal".equals(owner) ? List.of("CREATED_BY_ME")
                    : List.of("", "CREATED_BY_ME", "AUTHORIZED_TO_ME");
                for (boolean platformManager : List.of(false, true)) {
                    params.put("platformManager", platformManager);
                    for (String permission : permissions) {
                        params.put("permission", permission);
                        var boundSql = source.getBoundSql(params);
                        String sql = boundSql.getSql().replaceAll("\\s+", " ");
                        // 绑定候选始终限定本人创建或有效授权，管理员角色也不能扩大范围。
                        assertThat(sql).contains("a.resource_status = 2")
                            .contains("coalesce(k.black_count, 0) = 0")
                            .contains("and ( k.red_count > 0 or a.create_by = ? )")
                            .contains("and a.owner_type = ?")
                            .contains("and a.resource_biz_type in ( ? )")
                            .contains("and (UPPER(a.resource_code)")
                            .contains("or UPPER(a.resource_name) like concat('%', UPPER(?), '%'))")
                            .contains("order by coalesce(uc.use_count, 0) desc, "
                                + "coalesce(a.update_time, a.create_time) desc, a.resource_id desc")
                            .doesNotContain("or 1 = 1");
                        assertThat(boundSql.getParameterMappings()).extracting(mapping -> mapping.getProperty())
                            .contains("userId", "ownerType", "keyword");
                        if ("CREATED_BY_ME".equals(permission)) {
                            assertThat(sql).contains("and a.create_by = ? and (UPPER(a.resource_code)")
                                .doesNotContain("a.create_by != ?");
                        } else if ("AUTHORIZED_TO_ME".equals(permission)) {
                            // 授权给我的与我创建的互斥，避免两个筛选重复返回本人创建的技能。
                            assertThat(sql).contains("and (a.create_by is null or a.create_by != ?)")
                                .contains("and (k.red_count > 0 or k.allow_manage_count > 0)");
                        } else {
                            assertThat(sql).doesNotContain("and a.create_by = ? and (UPPER(a.resource_code)")
                                .doesNotContain("a.create_by != ?");
                        }
                    }
                }
            }
        }
    }

    @Test
    void resourceListQuery_preservesOtherSortModesAndUsesZeroForMissingCounts() throws IOException {
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
            params.put("resourceBizTypeList", List.of("SKILL"));
            // 未请求人数排序的技能列表保留原有排序，空绑定数继续返回 0。
            for (Boolean sortByUseCount : new Boolean[] {null, false}) {
                params.put("sortByUseCount", sortByUseCount);
                String sql = source.getBoundSql(params).getSql().replaceAll("\\s+", " ");
                assertThat(sql).contains("coalesce(uc.use_count, 0) as use_count")
                    .contains("order by case when a.resource_status = 3 then 1 else 0 end asc")
                    .doesNotContain("order by coalesce(uc.use_count, 0) desc");
            }
            params.put("sortByUseCount", true);
            for (List<String> bizTypes : List.of(List.of("MCP"), List.of("SKILL", "MCP"))) {
                params.put("resourceBizTypeList", bizTypes);
                String sql = source.getBoundSql(params).getSql().replaceAll("\\s+", " ");
                assertThat(sql).contains("order by case when a.resource_status = 3 then 1 else 0 end asc")
                    .doesNotContain("order by coalesce(uc.use_count, 0) desc");
            }
            params.put("resourceBizTypeList", List.of("SKILL"));
            params.put("includeFavorites", true);
            params.put("favoriteTenantId", 99L);
            String favoriteSql = source.getBoundSql(params).getSql().replaceAll("\\s+", " ");
            assertThat(favoriteSql).contains("order by coalesce(fc.favorite_count, 0) desc")
                .doesNotContain("order by coalesce(uc.use_count, 0) desc");
        }
    }

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
                .contains("pg.grant_type = 'SKILL_PUBLICATION'")
                .contains("end as auditType")
                .contains("pg.grant_type IN ('AVAILABLE_USE', 'MANAGE_APPLY')")
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
