package com.iwhalecloud.byai.manager.mapper.resource;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.apache.ibatis.mapping.BoundSql;
import org.apache.ibatis.scripting.xmltags.XMLLanguageDriver;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** 执行实际列表 SQL，校验资源中心与收藏排序在分页之前且不扩大资源可见范围。 */
class ResourceFavoriteQueryIntegrationTest {

    @Test
    void employeeRecommendationsReuseHistoricalUsageBeforePaginationAndKeepFavoriteSorting() throws Exception {
        try (Connection connection = DriverManager.getConnection("jdbc:sqlite::memory:")) {
            initialize(connection);
            for (long id = 1; id <= 35; id++) {
                resource(connection, id, "DIG_EMPLOYEE", 22, "enterprise", 2);
            }
            try (var statement = connection.createStatement()) {
                statement.executeUpdate("UPDATE ss_resource SET create_time = resource_id");
                statement.executeUpdate("""
                    INSERT INTO ss_res_ext_dig_employee(resource_id, agent_type)
                    VALUES (1, '017'), (2, '017'), (3, '017'), (4, '017')
                    """);
                // 同热度先比较修改时间、创建时间，最后用 ID 打破完全并列。
                statement.executeUpdate("UPDATE ss_resource SET update_time = 2 WHERE resource_id IN (3, 4)");
                statement.executeUpdate("UPDATE ss_resource SET create_time = 3 WHERE resource_id = 4");
                statement.executeUpdate("UPDATE ss_resource SET create_time = 4 WHERE resource_id = 2");
                statement.executeUpdate("UPDATE ss_resource SET create_time = 100 WHERE resource_id = 6");
                statement.executeUpdate("""
                    INSERT INTO byai_session_member VALUES
                        (1, 'AGENT'), (1, 'AGENT'), (2, 'AGENT'), (3, 'AGENT'), (4, 'AGENT'),
                        (5, 'AGENT'), (5, 'AGENT'), (5, 'AGENT'),
                        (6, 'AGENT'), (6, 'AGENT'), (7, 'AGENT'), (7, 'AGENT'),
                        (2, 'DOC'), (2, 'DOC'), (2, 'DOC')
                    """);
                statement.executeUpdate("INSERT INTO byai_resource_favorite_count VALUES (22, 6, 100)");
            }
            Map<String, Object> params = new HashMap<>();
            params.put("userId", 11L);
            params.put("ownerType", "enterprise");
            params.put("includeAllEnterpriseOwnerType", true);
            params.put("includeEmployeeGroup", true);
            params.put("employeeGroupFirst", true);
            params.put("orderField", "updateTime");
            params.put("orderBy", "desc");

            List<Long> expected = new ArrayList<>(List.of(1L, 2L, 4L, 3L, 5L, 7L, 6L));
            for (long id = 35; id >= 8; id--) {
                expected.add(id);
            }
            assertThat(queryTwoPageIds(connection, "DIG_EMPLOYEE", params)).containsExactlyElementsOf(expected);

            // 即使员工组优先参数同时存在，商业版仍优先执行原收藏数、修改时间、ID 排序。
            params.put("includeFavorites", true);
            params.put("favoriteTenantId", 22L);
            List<Long> favoriteExpected = new ArrayList<>(List.of(6L));
            for (long id = 35; id >= 8; id--) {
                favoriteExpected.add(id);
            }
            favoriteExpected.addAll(List.of(7L, 5L, 4L, 3L, 2L, 1L));
            assertThat(queryTwoPageIds(connection, "DIG_EMPLOYEE", params))
                .containsExactlyElementsOf(favoriteExpected);
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"SKILL", "KG_DOC", "KG_QA", "KG_TERM", "MCP", "TOOLKIT", "AGENT"})
    void managementSortsByTimeAcrossStatesAndPreservesOwnerScope(String type) throws Exception {
        for (String owner : List.of("personal", "enterprise")) {
            try (Connection connection = DriverManager.getConnection("jdbc:sqlite::memory:")) {
                initialize(connection);
                int[] states = {0, 2, 3};
                for (long id = 1; id <= 35; id++) {
                    int status = "personal".equals(owner) ? 2 : states[(int) (id % 3)];
                    resource(connection, id, type, 22, owner, status);
                }
                resource(connection, 40, type, 22, owner, -1);
                resource(connection, 41, type, 22, owner, 2);
                try (var statement = connection.createStatement()) {
                    statement.executeUpdate("UPDATE ss_resource SET update_time = NULL, create_time = 36 WHERE resource_id = 4");
                    statement.executeUpdate("UPDATE ss_resource SET update_time = 36 WHERE resource_id = 3");
                    statement.executeUpdate("UPDATE ss_resource SET create_by = 99 WHERE resource_id = 41");
                }
                Map<String, Object> params = new HashMap<>();
                params.put("userId", 11L);
                params.put("platformManager", true);
                params.put("ownerType", owner);
                params.put("includeAllEnterpriseOwnerType", "enterprise".equals(owner));
                params.put("permission", "personal".equals(owner) ? "CREATED_BY_ME" : "MANAGEABLE_BY_ME");
                params.put("resourceBizTypeList", List.of(type));
                params.put("resourceStatus", "personal".equals(owner) ? "2" : "");
                params.put("excludeDeleted", true);
                params.put("sortMode", "UPDATED_DESC");
                List<Long> ids = queryTwoPageIds(connection, type, params);
                List<Long> expected = new ArrayList<>(List.of(4L, 3L));
                for (long id = 35; id >= 5; id--) {
                    expected.add(id);
                }
                expected.addAll(List.of(2L, 1L));
                // 同时间按 ID 降序，空更新时间取创建时间；最近下架的 35 仍按时间排在前面。
                assertThat(ids).containsExactlyElementsOf(expected).doesNotContain(40L, 41L);
            }
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"SKILL", "KG_DOC", "KG_QA", "KG_TERM", "MCP", "TOOLKIT", "AGENT"})
    void resourceCenterTabSortsApplyBeforePaginationWithOptionalFavorites(String type) throws Exception {
        try (Connection connection = DriverManager.getConnection("jdbc:sqlite::memory:")) {
            initialize(connection);
            for (long id = 1; id <= 35; id++) {
                resource(connection, id, type, 22, "enterprise", 2);
            }
            for (long id = 1001; id <= 1004; id++) {
                resource(connection, id, "DIG_EMPLOYEE", 22, "enterprise", id == 1004 ? 3 : 2);
            }
            try (var statement = connection.createStatement()) {
                // 4 的更新时间为空，创建时间与 3 的更新时间相同，需以 ID 降序打破并列。
                statement.executeUpdate("UPDATE ss_resource SET update_time = NULL, create_time = 3 WHERE resource_id = 4");
                statement.executeUpdate("""
                    INSERT INTO ss_resource_rel_detail VALUES
                        (1001, 1), (1001, 1), (1002, 1), (1003, 1), (1004, 1),
                        (1001, 2), (1002, 2), (1004, 2), (1001, 3), (1002, 3),
                        (1001, 4), (1001, 4), (1001, 4), (1002, 4)
                    """);
                statement.executeUpdate("""
                    INSERT INTO byai_resource_favorite_count VALUES
                        (22, 2, 100), (22, 3, 4), (22, 4, 4), (22, 5, 200), (33, 1, 999)
                    """);
            }
            Map<String, Object> params = new HashMap<>();
            params.put("userId", 11L);
            params.put("ownerType", "enterprise");
            params.put("includeAllEnterpriseOwnerType", true);
            params.put("resourceBizTypeList", List.of(type));
            params.put("keyword", "visible");
            for (boolean includeFavorites : List.of(false, true)) {
                params.put("includeFavorites", includeFavorites);
                params.put("favoriteTenantId", includeFavorites ? 22L : null);
                params.put("sortMode", "POPULARITY_DESC");
                List<Long> popularIds = queryTwoPageIds(connection, type, params);
                List<Long> expectedPopularIds = new ArrayList<>(includeFavorites
                    ? List.of(1L, 2L, 4L, 3L, 5L) : List.of(1L, 4L, 3L, 2L));
                for (long id = 35; id >= (includeFavorites ? 6 : 5); id--) {
                    expectedPopularIds.add(id);
                }
                // 添加数量先于收藏数量；重复关联和已下架员工不增加添加数量。
                assertThat(popularIds).containsExactlyElementsOf(expectedPopularIds);

                params.put("sortMode", "UPDATED_DESC");
                List<Long> updatedIds = queryTwoPageIds(connection, type, params);
                List<Long> expectedUpdatedIds = new ArrayList<>();
                for (long id = 35; id >= 1; id--) {
                    expectedUpdatedIds.add(id);
                }
                // 按更新时间排序时，热门但较旧的资源不会压过较新的未添加资源。
                assertThat(updatedIds).containsExactlyElementsOf(expectedUpdatedIds);
            }
        }
    }

    private List<Long> queryTwoPageIds(Connection connection, String type, Map<String, Object> params) throws Exception {
        List<Row> first = query(connection, type, params, 0);
        List<Row> second = query(connection, type, params, 30);
        assertThat(first).hasSize(30);
        assertThat(second).hasSize(5);
        List<Long> ids = new ArrayList<>(first.stream().map(Row::id).toList());
        ids.addAll(second.stream().map(Row::id).toList());
        assertThat(ids).doesNotHaveDuplicates();
        return ids;
    }

    @ParameterizedTest
    @ValueSource(strings = {"DIG_EMPLOYEE", "SKILL", "KG_DOC", "MCP"})
    void listsSortBeforePaginationPreserveOfficialVisibilityAndIsolateFavorites(String type) throws Exception {
        try (Connection connection = DriverManager.getConnection("jdbc:sqlite::memory:")) {
            initialize(connection);
            for (long id = 101; id <= 142; id++) {
                resource(connection, id, type, 22, "enterprise", 2);
            }
            resource(connection, 900, type, 33, "enterprise", 2);
            resource(connection, 901, type, 22, "enterprise", 3);
            resource(connection, 902, "SKILL_GROUP", 22, "enterprise", 2);
            resource(connection, 903, type, 22, "enterprise", 2);
            resource(connection, 904, type, 22, "personal", 2);
            resource(connection, 905, type, 22, "enterprise", 2);
            try (var statement = connection.createStatement()) {
                statement.executeUpdate("UPDATE ss_resource SET com_acct_id = NULL WHERE resource_id = 905");
                statement.executeUpdate("""
                    INSERT INTO byai_resource_favorite_count VALUES
                        (22, 142, 9), (22, 140, 5), (22, 138, 5), (22, 102, 1),
                        (33, 900, 100), (22, 901, 100), (22, 902, 100), (22, 903, 100), (22, 904, 100)
                    """);
                statement.executeUpdate("""
                    INSERT INTO byai_resource_favorite VALUES
                        (22, 11, 142), (22, 11, 140), (22, 11, 102), (22, 12, 138),
                        (33, 11, 900), (22, 11, 901), (22, 11, 903), (22, 11, 904)
                    """);
                statement.executeUpdate("""
                    INSERT INTO au_privilege_grant
                        (grant_obj_id, grant_obj_type, grant_to_obj_type, grant_to_obj_id, grant_type, grant_to_type, status_cd)
                    VALUES (903, 'DIG_EMPLOYEE', 'USER', 11, 'FORCE_USE', 'BLACK', 'A')
                    """);
            }

            Map<String, Object> params = new HashMap<>();
            params.put("userId", 11L);
            params.put("favoriteTenantId", 22L);
            params.put("includeFavorites", true);
            params.put("includeEmployeeGroup", true);
            params.put("includeAllEnterpriseOwnerType", true);
            params.put("ownerType", "enterprise");
            params.put("resourceBizTypeList", List.of(type));
            params.put("keyword", "visible");

            List<Row> first = query(connection, type, params, 0);
            List<Row> second = query(connection, type, params, 30);
            assertThat(first).hasSize(30);
            assertThat(second).hasSize(14);
            assertThat(first.subList(0, 3)).containsExactly(
                new Row(142, 9, true), new Row(140, 5, true), new Row(138, 5, false));
            List<Long> allIds = new ArrayList<>(first.stream().map(Row::id).toList());
            allIds.addAll(second.stream().map(Row::id).toList());
            assertThat(allIds).doesNotHaveDuplicates().contains(900L, 905L)
                .doesNotContain(901L, 902L, 903L, 904L);
            assertThat(second).anyMatch(row -> row.count() == 0 && !row.favorited());

            Map<String, Object> originalParams = new HashMap<>(params);
            originalParams.remove("includeFavorites");
            List<Long> originalIds = new ArrayList<>(query(connection, type, originalParams, 0).stream().map(Row::id).toList());
            originalIds.addAll(query(connection, type, originalParams, 30).stream().map(Row::id).toList());
            assertThat(allIds).containsExactlyInAnyOrderElementsOf(originalIds);

            params.put("favoritesOnly", true);
            assertThat(query(connection, type, params, 0).stream().map(Row::id).toList())
                .containsExactly(142L, 140L, 102L);
            params.put("userId", 12L);
            assertThat(query(connection, type, params, 0).stream().map(Row::id).toList()).containsExactly(138L);
            params.put("keyword", "not-present");
            assertThat(query(connection, type, params, 0)).isEmpty();
        }
    }

    private List<Row> query(Connection connection, String type, Map<String, Object> params, int offset) throws Exception {
        String file = "DIG_EMPLOYEE".equals(type) ? "index/IndexMapper.xml" : "auth/PrivilegeGrantMapper.xml";
        String id = "DIG_EMPLOYEE".equals(type) ? "discover" : "listResourceAuth";
        String xml;
        try (var input = getClass().getResourceAsStream("/com/iwhalecloud/byai/manager/mapper/" + file)) {
            assertThat(input).isNotNull();
            xml = new String(input.readAllBytes(), StandardCharsets.UTF_8);
        }
        int start = xml.indexOf("<select id=\"" + id + "\"");
        String body = xml.substring(xml.indexOf('>', start) + 1, xml.indexOf("</select>", start));
        BoundSql bound = new XMLLanguageDriver().createSqlSource(new Configuration(),
            "<script>" + body + "</script>", Map.class).getBoundSql(params);
        try (var statement = connection.prepareStatement(bound.getSql() + " LIMIT 30 OFFSET " + offset)) {
            int index = 1;
            for (var parameter : bound.getParameterMappings()) {
                String property = parameter.getProperty();
                statement.setObject(index++, bound.hasAdditionalParameter(property)
                    ? bound.getAdditionalParameter(property) : params.get(property));
            }
            List<Row> rows = new ArrayList<>();
            try (var result = statement.executeQuery()) {
                while (result.next()) {
                    boolean includeFavorites = Boolean.TRUE.equals(params.get("includeFavorites"));
                    rows.add(new Row(result.getLong("resource_id"), includeFavorites ? result.getLong("favorite_count") : 0,
                        includeFavorites && result.getBoolean("favorited")));
                }
            }
            return rows;
        }
    }

    private void resource(Connection connection, long id, String type, long tenant, String owner, int status)
        throws Exception {
        try (var statement = connection.prepareStatement("""
            INSERT INTO ss_resource(resource_id, resource_biz_type, com_acct_id, owner_type, resource_status,
                resource_name, resource_code, create_by, update_time) VALUES (?, ?, ?, ?, ?, 'visible', 'visible', 11, ?)
            """)) {
            statement.setLong(1, id);
            statement.setString(2, type);
            statement.setLong(3, tenant);
            statement.setString(4, owner);
            statement.setInt(5, status);
            statement.setLong(6, id);
            statement.executeUpdate();
        }
    }

    private void initialize(Connection connection) throws Exception {
        try (var statement = connection.createStatement()) {
            statement.execute("""
                CREATE TABLE ss_resource(resource_id INTEGER PRIMARY KEY, resource_biz_type TEXT, com_acct_id INTEGER,
                    owner_type TEXT, resource_status INTEGER, resource_name TEXT, resource_code TEXT,
                    resource_desc TEXT, avatar TEXT, catalog_id INTEGER, create_by INTEGER, update_time INTEGER,
                    create_time INTEGER, system_code TEXT, resource_source_pk_id TEXT, resource_type TEXT,
                    sample TEXT, tags TEXT, resource_version_id INTEGER, host_type TEXT, man_org_id INTEGER,
                    man_user_id INTEGER, index_list TEXT, update_by INTEGER, resource_d_verid INTEGER,
                    resource_r_verid INTEGER, publish_time TEXT, shelf_time TEXT, unshelf_time TEXT,
                    auth_status TEXT, publish_portal TEXT, parent_resource_id INTEGER, publish_type TEXT)
                """);
            statement.execute("""
                CREATE TABLE ss_res_ext_dig_employee(resource_id INTEGER PRIMARY KEY, agent_type TEXT,
                    agent_home_url TEXT, prologue TEXT, integration_type TEXT, agent_dev_type TEXT,
                    create_type TEXT, terminal TEXT, open_super_helper TEXT, tag_name TEXT, skills TEXT)
                """);
            statement.execute("""
                CREATE TABLE ss_res_ext_skill(resource_id INTEGER PRIMARY KEY, skill_type TEXT, source_type TEXT,
                    version TEXT, skill_url TEXT, skill_package_format TEXT, skill_original_filename TEXT,
                    skill_package_size INTEGER, skill_package_hash TEXT, target_content TEXT, sync_status TEXT,
                    sync_error TEXT, last_sync_time TEXT)
                """);
            statement.execute("CREATE TABLE po_users(user_id INTEGER PRIMARY KEY, user_name TEXT)");
            statement.execute("CREATE TABLE ss_resource_rel_detail(resource_id INTEGER, rel_resource_id INTEGER)");
            statement.execute("CREATE TABLE byai_session_member(mem_obj_id INTEGER, mem_obj_type TEXT)");
            statement.execute("""
                CREATE TABLE au_privilege_grant(grant_obj_id INTEGER, grant_obj_type TEXT, grant_to_type TEXT,
                    status_cd TEXT, grant_type TEXT, grant_to_obj_type TEXT, grant_to_obj_id INTEGER, create_date TEXT)
                """);
            statement.execute("""
                CREATE TABLE byai_resource_favorite_count(com_acct_id INTEGER, resource_id INTEGER,
                    favorite_count INTEGER NOT NULL CHECK(favorite_count >= 0), PRIMARY KEY(com_acct_id, resource_id))
                """);
            statement.execute("""
                CREATE TABLE byai_resource_favorite(com_acct_id INTEGER, user_id INTEGER, resource_id INTEGER,
                    PRIMARY KEY(com_acct_id, user_id, resource_id))
                """);
        }
    }

    private record Row(long id, long count, boolean favorited) {}
}
