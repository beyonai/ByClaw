package com.iwhalecloud.byai.manager.mapper.auth;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.apache.ibatis.mapping.SqlSource;
import org.apache.ibatis.scripting.xmltags.XMLLanguageDriver;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** 执行真实审核查询片段，验证搜索和资源类型、状态条件叠加且不会把输入当 SQL 或通配符。 */
class ResourceAuditSearchMapperTest {

    @ParameterizedTest
    @ValueSource(strings = {"SKILL", "KG_DOC", "KG_QA", "KG_TERM", "MCP", "TOOLKIT", "AGENT"})
    void searchesNamesWithinResourceTypeAndAuditStatus(String bizType) throws Exception {
        try (Connection connection = DriverManager.getConnection(
            "jdbc:h2:mem:audit_search_" + UUID.randomUUID() + ";MODE=PostgreSQL")) {
            seed(connection, bizType);
            SqlSource source = auditQuery();
            assertThat(ids(connection, source, bizType, false, "ALP")).containsExactly(1L);
            assertThat(ids(connection, source, bizType, true, "财务")).containsExactly(4L, 3L);
            assertThat(ids(connection, source, bizType, false, "财务")).containsExactly(5L, 1L);
            for (String literal : List.of("%", "_", "50%_")) {
                assertThat(ids(connection, source, bizType, false, literal)).containsExactly(5L);
            }
            assertThat(ids(connection, source, bizType, false, "不存在")).isEmpty();
            assertThat(ids(connection, source, bizType, false, "' OR 1=1 --")).isEmpty();
            for (String keyword : new String[] {null, ""}) {
                assertThat(ids(connection, source, bizType, false, keyword)).containsExactly(5L, 2L, 1L);
                assertThat(ids(connection, source, bizType, true, keyword)).containsExactly(4L, 3L);
            }
            if ("SKILL".equals(bizType)) {
                try (var statement = connection.createStatement()) {
                    statement.execute("INSERT INTO au_privilege_grant SELECT 7, 'SKILL_PUBLICATION', grant_obj_id, "
                        + "grant_obj_type, grant_to_obj_id, grant_to_obj_type, grant_to_type, oper_type, status_cd, "
                        + "create_date, update_date, update_staff FROM au_privilege_grant WHERE privilege_grant_id = 1");
                    statement.execute("INSERT INTO au_privilege_grant SELECT 8, 'SKILL_PUBLICATION', grant_obj_id, "
                        + "grant_obj_type, grant_to_obj_id, grant_to_obj_type, grant_to_type, oper_type, status_cd, "
                        + "create_date, update_date, update_staff FROM au_privilege_grant WHERE privilege_grant_id = 3");
                }
                // 技能上架申请与使用申请共享名称筛选，但不能被固定使用申请类型条件漏掉。
                assertThat(ids(connection, source, bizType, false, "alp")).containsExactly(7L, 1L);
                assertThat(ids(connection, source, bizType, true, "alp")).containsExactly(8L, 4L, 3L);
            }
        }
    }

    private SqlSource auditQuery() throws Exception {
        try (var input = getClass().getResourceAsStream(
            "/com/iwhalecloud/byai/manager/mapper/auth/PrivilegeGrantMapper.xml")) {
            assertThat(input).isNotNull();
            String xml = new String(input.readAllBytes(), StandardCharsets.UTF_8);
            int start = xml.indexOf("<select id=\"queryDigitalEmployeeUseApplyAudit\"");
            String query = xml.substring(xml.indexOf('>', start) + 1, xml.indexOf("</select>", start));
            return new XMLLanguageDriver().createSqlSource(new Configuration(), "<script>" + query + "</script>", Map.class);
        }
    }

    private List<Long> ids(Connection connection, SqlSource source, String bizType, boolean history,
        String keyword) throws Exception {
        Map<String, Object> params = new HashMap<>();
        params.put("history", history);
        params.put("resourceBizTypeList", List.of(bizType));
        params.put("keyword", keyword);
        var bound = source.getBoundSql(params);
        try (var statement = connection.prepareStatement(bound.getSql())) {
            for (int i = 0; i < bound.getParameterMappings().size(); i++) {
                String property = bound.getParameterMappings().get(i).getProperty();
                statement.setObject(i + 1, bound.hasAdditionalParameter(property)
                    ? bound.getAdditionalParameter(property) : params.get(property));
            }
            List<Long> result = new ArrayList<>();
            try (var rows = statement.executeQuery()) {
                while (rows.next()) result.add(rows.getLong(1));
            }
            return result;
        }
    }

    private void seed(Connection connection, String bizType) throws Exception {
        try (var statement = connection.createStatement()) {
            statement.execute("CREATE TABLE ss_resource (resource_id BIGINT, resource_name VARCHAR, "
                + "resource_biz_type VARCHAR, owner_type VARCHAR, avatar VARCHAR)");
            statement.execute("CREATE TABLE ss_res_ext_dig_employee (resource_id BIGINT, agent_type VARCHAR)");
            statement.execute("CREATE TABLE po_users (user_id BIGINT, user_name VARCHAR)");
            statement.execute("CREATE TABLE au_privilege_grant (privilege_grant_id BIGINT, grant_type VARCHAR, "
                + "grant_obj_id BIGINT, grant_obj_type VARCHAR, grant_to_obj_id BIGINT, grant_to_obj_type VARCHAR, "
                + "grant_to_type VARCHAR, oper_type VARCHAR, status_cd VARCHAR, create_date TIMESTAMP, "
                + "update_date TIMESTAMP, update_staff BIGINT)");
        }
        String[] names = {"财务 Alpha", "销售 Beta", "财务 Alpha", "财务 Alpha", "财务 50%_完成", "财务 Alpha"};
        String[] statuses = {"P", "P", "X", "R", "P", "P"};
        try (var resource = connection.prepareStatement("INSERT INTO ss_resource VALUES (?, ?, ?, 'enterprise', null)");
             var grant = connection.prepareStatement("INSERT INTO au_privilege_grant VALUES "
                 + "(?, 'AVAILABLE_USE', ?, ?, 10, 'USER', 'RED', 'READ', ?, '2026-10-10 10:00:00', null, null)")) {
            for (int i = 0; i < names.length; i++) {
                // 第六条属于其他资源类型，名称相同也不得跨页签返回。
                String type = i == 5 ? "DIG_EMPLOYEE" : bizType;
                resource.setLong(1, i + 1);
                resource.setString(2, names[i]);
                resource.setString(3, type);
                resource.executeUpdate();
                grant.setLong(1, i + 1);
                grant.setLong(2, i + 1);
                grant.setString(3, type);
                grant.setString(4, statuses[i]);
                grant.executeUpdate();
            }
        }
    }
}
