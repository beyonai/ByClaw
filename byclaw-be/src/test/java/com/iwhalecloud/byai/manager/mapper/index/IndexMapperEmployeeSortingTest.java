package com.iwhalecloud.byai.manager.mapper.index;

import static org.assertj.core.api.Assertions.assertThat;

import com.github.pagehelper.parser.CountSqlParser;
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

/** 执行真实 Mapper SQL 和 PageHelper 计数 SQL，验证分页排序与可见范围。 */
class IndexMapperEmployeeSortingTest {

    @Test
    void pickerSortsDefaultThenRecentUsageThenTimesAndIdAcrossPages() throws Exception {
        try (Connection connection = database()) {
            assertThat(queryPages(connection, "DEFAULT_USAGE_DESC", 1L))
                .containsExactly(1L, 5L, 4L, 3L, 2L, 6L, 7L);
            // 默认员工也可以是员工组，不受组类型或使用次数影响。
            assertThat(queryPages(connection, "DEFAULT_USAGE_DESC", 6L))
                .containsExactly(6L, 5L, 4L, 3L, 2L, 7L, 1L);
        }
    }

    @Test
    void pickerWithoutVisibleDefaultFallsBackToUsageAndDoesNotExposeUnavailableEmployees() throws Exception {
        try (Connection connection = database()) {
            for (Long defaultId : new Long[] {null, 8L, 9L}) {
                assertThat(queryPages(connection, "DEFAULT_USAGE_DESC", defaultId))
                    .containsExactly(5L, 4L, 3L, 2L, 6L, 7L, 1L);
            }
        }
    }

    @Test
    void cardsSortGroupsThenTimesAndIdIgnoringDefaultUsagePinAndGrantTime() throws Exception {
        try (Connection connection = database()) {
            assertThat(queryPages(connection, "GROUP_UPDATED_DESC", 1L))
                .containsExactly(7L, 6L, 5L, 4L, 3L, 2L, 1L);
        }
    }

    @Test
    void paginationCountPreservesGroupAndPermissionFiltersForEverySortMode() throws Exception {
        try (Connection connection = database()) {
            for (String sortMode : new String[] {"DEFAULT_USAGE_DESC", "GROUP_UPDATED_DESC", null}) {
                Map<String, Object> params = parameters(sortMode, 6L);
                assertCount(connection, boundSql(params), params, 7L);
                // 默认员工为员工组时，排除员工组的条件仍需同时作用于总数查询。
                params.put("excludeEmployeeGroup", true);
                assertCount(connection, boundSql(params), params, 5L);
                params.put("userId", 12L);
                assertCount(connection, boundSql(params), params, 0L);
            }
        }
    }

    private Map<String, Object> parameters(String sortMode, Long defaultId) {
        Map<String, Object> params = new HashMap<>();
        params.put("userId", 11L);
        params.put("recentlyStartDate", "2026-07-15 00:00:00");
        params.put("sortMode", sortMode);
        params.put("defaultDigitalEmployeeId", defaultId);
        return params;
    }

    private BoundSql boundSql(Map<String, Object> params) throws Exception {
        String path = "/com/iwhalecloud/byai/manager/mapper/index/IndexMapper.xml";
        try (var input = getClass().getResourceAsStream(path)) {
            assertThat(input).isNotNull();
            String xml = new String(input.readAllBytes(), StandardCharsets.UTF_8);
            int start = xml.indexOf("<select id=\"selectAuthDigitEmploy\"");
            assertThat(start).isGreaterThanOrEqualTo(0);
            int bodyStart = xml.indexOf('>', start) + 1;
            int end = xml.indexOf("</select>", bodyStart);
            String script = "<script>" + xml.substring(bodyStart, end) + "</script>";
            return new XMLLanguageDriver().createSqlSource(new Configuration(), script, Map.class)
                .getBoundSql(params);
        }
    }

    private void assertCount(Connection connection, BoundSql boundSql, Map<String, Object> params, long expected)
        throws Exception {
        String countSql = new CountSqlParser().getSmartCountSql(boundSql.getSql());
        // SQLite 容忍聚合查询按非聚合列排序，因此还要显式阻止 PostgreSQL 报错的 ORDER BY 回归。
        assertThat(countSql).doesNotContainIgnoringCase("order by");
        try (var statement = connection.prepareStatement(countSql)) {
            // 使用原始 BoundSql 的映射绑定，确保计数改写没有丢失参数或打乱参数顺序。
            for (int i = 0; i < boundSql.getParameterMappings().size(); i++) {
                statement.setObject(i + 1, params.get(boundSql.getParameterMappings().get(i).getProperty()));
            }
            try (var rows = statement.executeQuery()) {
                assertThat(rows.next()).isTrue();
                assertThat(rows.getLong(1)).isEqualTo(expected);
                assertThat(rows.next()).isFalse();
            }
        }
    }

    private List<Long> queryPages(Connection connection, String sortMode, Long defaultId) throws Exception {
        Map<String, Object> params = parameters(sortMode, defaultId);
        BoundSql boundSql = boundSql(params);
        assertCount(connection, boundSql, params, 7L);
        List<Long> ids = new ArrayList<>();
        for (int offset = 0; offset < 9; offset += 3) {
            try (var statement = connection.prepareStatement(boundSql.getSql() + " limit 3 offset " + offset)) {
                for (int i = 0; i < boundSql.getParameterMappings().size(); i++) {
                    statement.setObject(i + 1, params.get(boundSql.getParameterMappings().get(i).getProperty()));
                }
                try (var rows = statement.executeQuery()) {
                    while (rows.next()) {
                        ids.add(rows.getLong("resource_id"));
                    }
                }
            }
        }
        assertThat(ids).doesNotHaveDuplicates();
        return ids;
    }

    private Connection database() throws Exception {
        Connection connection = DriverManager.getConnection("jdbc:sqlite::memory:");
        try (var statement = connection.createStatement()) {
            statement.execute("""
                create table ss_resource (
                    resource_id integer, resource_name text, resource_code text, resource_desc text,
                    owner_type text, resource_status integer, avatar text, create_by integer,
                    update_time text, create_time text, resource_biz_type text)
                """);
            statement.execute("""
                create table ss_res_ext_dig_employee (
                    resource_id integer, agent_type text, agent_home_url text, prologue text,
                    integration_type text, agent_dev_type text, create_type text, terminal text,
                    open_super_helper integer, tag_name text, machine_channel text)
                """);
            statement.execute("create table po_users (user_id integer, user_name text, assistant_id integer)");
            statement.execute("""
                create table suas_superassist_sub_agent (
                    is_top integer, top_time text, agent_id integer, superassist_id integer, status_cd text)
                """);
            statement.execute("""
                create table byai_session_member (
                    mem_obj_id integer, mem_obj_type text, creator_id integer, create_time text)
                """);
            statement.execute("""
                create table au_privilege_grant (
                    grant_obj_id integer, grant_to_type text, status_cd text, grant_type text,
                    create_date text, grant_obj_type text, grant_to_obj_type text, grant_to_obj_id integer)
                """);
            statement.executeUpdate("insert into po_users values (11, 'owner', 100)");
            // 4、5 的时间完全相同，4 额外有置顶与授权，仍应由 ID 较大的 5 排在前面。
            statement.executeUpdate("insert into suas_superassist_sub_agent values (1, '2026-10-13', 4, 100, '00A')");
            statement.executeUpdate("""
                insert into au_privilege_grant values
                    (4, 'RED', 'A', 'AVAILABLE_USE', '2026-10-13', 'DIG_EMPLOYEE', 'USER', 11)
                """);
        }
        resource(connection, 1, "016", "2025-01-01", "2025-01-01", 0);
        resource(connection, 2, "016", "2026-01-01", "2026-01-01", 3);
        resource(connection, 3, "016", "2026-02-01", "2026-01-01", 3);
        resource(connection, 4, "016", "2026-02-01", "2026-02-01", 3);
        resource(connection, 5, "016", "2026-02-01", "2026-02-01", 3);
        resource(connection, 6, "017", "2025-01-01", "2025-01-01", 1);
        // 空更新时间延续创建时间兜底，避免没有修改记录的新建员工排序异常。
        resource(connection, 7, "017", null, "2026-03-01", 0);
        resource(connection, 8, "016", "2026-10-01", "2026-10-01", 0);
        resource(connection, 9, "016", "2026-10-01", "2026-10-01", 0);
        try (var statement = connection.createStatement()) {
            statement.executeUpdate("update ss_resource set resource_status = 3 where resource_id = 8");
            statement.executeUpdate("update ss_resource set create_by = 99 where resource_id = 9");
            // 其他用户和90天之前的记录都不能增加当前用户的使用次数。
            statement.executeUpdate("""
                insert into byai_session_member values
                    (7, 'AGENT', 99, '2026-10-01'), (7, 'AGENT', 11, '2026-01-01'),
                    (7, 'USER', 11, '2026-10-01')
                """);
        }
        return connection;
    }

    private void resource(Connection connection, long id, String type, String updated, String created, int uses)
        throws Exception {
        try (var statement = connection.prepareStatement("""
            insert into ss_resource
                (resource_id, resource_name, resource_biz_type, owner_type, resource_status,
                 create_by, update_time, create_time)
            values (?, 'employee', 'DIG_EMPLOYEE', 'personal', 2, 11, ?, ?)
            """)) {
            statement.setLong(1, id);
            statement.setString(2, updated);
            statement.setString(3, created);
            statement.executeUpdate();
        }
        try (var statement = connection.prepareStatement(
            "insert into ss_res_ext_dig_employee (resource_id, agent_type) values (?, ?)")) {
            statement.setLong(1, id);
            statement.setString(2, type);
            statement.executeUpdate();
        }
        try (var statement = connection.prepareStatement(
            "insert into byai_session_member values (?, 'AGENT', 11, '2026-10-01')")) {
            statement.setLong(1, id);
            for (int i = 0; i < uses; i++) {
                statement.executeUpdate();
            }
        }
    }
}
