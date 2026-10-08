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
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** 执行实际列表 SQL，校验收藏排序在分页之前且不扩大资源可见范围。 */
class ResourceFavoriteQueryIntegrationTest {
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
