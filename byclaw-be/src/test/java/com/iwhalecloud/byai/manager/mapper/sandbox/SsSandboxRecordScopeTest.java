package com.iwhalecloud.byai.manager.mapper.sandbox;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashMap;
import java.util.Map;

import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.Test;

class SsSandboxRecordScopeTest {

    private String sql(String statement, String ownerScope, Long enterpriseId) throws Exception {
        String resource = "com/iwhalecloud/byai/manager/mapper/sandbox/SsSandboxRecordMapper.xml";
        Configuration configuration = new Configuration();
        try (var input = getClass().getClassLoader().getResourceAsStream(resource)) {
            new XMLMapperBuilder(input, configuration, resource, configuration.getSqlFragments()).parse();
        }
        Map<String, Object> parameters = new HashMap<>();
        parameters.put("ownerScope", ownerScope);
        parameters.put("enterpriseId", enterpriseId);
        parameters.put("id", 7L);
        parameters.put("offset", 0);
        parameters.put("pageSize", 20);
        return configuration.getMappedStatement(SsSandboxRecordMapper.class.getName() + "." + statement)
            .getBoundSql(parameters).getSql().replaceAll("\\s+", " ");
    }

    @Test
    void userListCountAndRecordActionsUseTheSameActiveEnterpriseMembershipBoundary() throws Exception {
        for (String statement : java.util.List.of("selectByPage", "countByCondition", "countEnterpriseUserSandbox")) {
            assertThat(sql(statement, "USER", 123L))
                .contains("enterprise_id IS NULL AND EXISTS", "u.user_code = ss_sandbox_record.user_code",
                    "u.state = 'A'", "m.enterprise_id = ? AND m.status = 'ACTIVE'");
        }
        assertThat(sql("countEnterpriseUserSandbox", "USER", 123L)).contains("owner_scope = 'USER'");
    }

    @Test
    void platformAndTenantQueriesKeepTheirExistingScope() throws Exception {
        assertThat(sql("selectByPage", "USER", null)).doesNotContain("tenant_user_membership");
        assertThat(sql("selectByPage", "TENANT", 123L))
            .contains("enterprise_id = ?").doesNotContain("tenant_user_membership");
    }
}
