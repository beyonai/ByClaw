package com.iwhalecloud.byai.manager.mapper.index;

import static org.assertj.core.api.Assertions.assertThat;

import com.iwhalecloud.byai.manager.qo.index.DiscoverQo;
import com.iwhalecloud.byai.manager.qo.index.MyAuthEmployQo;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.apache.ibatis.mapping.SqlSource;
import org.apache.ibatis.scripting.xmltags.XMLLanguageDriver;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.Test;

class IndexMapperPermissionSqlTest {

    /** 在分页前排除创建者，员工与员工组共用同一权限口径。 */
    @Test
    void availableAuthorizedFilter_excludesCreatorForEmployeesAndGroups() throws IOException {
        SqlSource source = querySource("selectAuthDigitEmploy", MyAuthEmployQo.class);
        MyAuthEmployQo qo = new MyAuthEmployQo();
        qo.setUserId(2L);
        qo.setType("authorize");
        for (String agentType : new String[] {null, "017"}) {
            qo.setAgentType(agentType);
            assertThat(sql(source, qo)).contains("and k.red_count > 0")
                .contains("and (a.create_by is null or a.create_by != ?)")
                .contains("and (k.black_count = 0 or k.black_count is null)");
        }
        qo.setType("owner");
        assertThat(sql(source, qo)).contains("and a.create_by = ?")
            .doesNotContain("a.create_by != ?");
        qo.setType(null);
        assertThat(sql(source, qo)).contains("and (k.red_count > 0 or a.create_by = ?)")
            .doesNotContain("a.create_by != ?");
    }

    @Test
    void officialAuthorizedFilter_excludesCreatorForEmployeesAndGroups() throws IOException {
        SqlSource source = querySource("discover", DiscoverQo.class);
        DiscoverQo qo = new DiscoverQo();
        qo.setUserId(2L);
        qo.setPermission("AUTHORIZED_TO_ME");
        for (String agentType : new String[] {null, "017"}) {
            qo.setAgentType(agentType);
            assertThat(sql(source, qo)).contains("and (a.create_by is null or a.create_by != ?)")
                .contains("and (k.red_count > 0 or k.allow_manage_count > 0)");
        }
        qo.setPermission("CREATED_BY_ME");
        assertThat(sql(source, qo)).contains("and a.create_by = ?")
            .doesNotContain("a.create_by != ?");
        qo.setPermission(null);
        assertThat(sql(source, qo)).doesNotContain("a.create_by != ?");
    }

    private SqlSource querySource(String statementId, Class<?> parameterType) throws IOException {
        String path = "/com/iwhalecloud/byai/manager/mapper/index/IndexMapper.xml";
        try (var input = getClass().getResourceAsStream(path)) {
            assertThat(input).isNotNull();
            String xml = new String(input.readAllBytes(), StandardCharsets.UTF_8);
            int start = xml.indexOf("<select id=\"" + statementId + "\"");
            assertThat(start).isGreaterThanOrEqualTo(0);
            int bodyStart = xml.indexOf('>', start) + 1;
            int end = xml.indexOf("</select>", bodyStart);
            assertThat(end).isGreaterThan(bodyStart);
            String script = "<script>" + xml.substring(bodyStart, end) + "</script>";
            return new XMLLanguageDriver().createSqlSource(new Configuration(), script, parameterType);
        }
    }

    private static String sql(SqlSource source, Object parameter) {
        return source.getBoundSql(parameter).getSql().replaceAll("\\s+", " ");
    }
}
