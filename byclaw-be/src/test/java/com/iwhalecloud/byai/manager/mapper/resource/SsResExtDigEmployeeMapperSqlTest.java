package com.iwhalecloud.byai.manager.mapper.resource;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

class SsResExtDigEmployeeMapperSqlTest {

    @Test
    void memberCandidateQuery_avoidsEmptyStringComparisonInOpenGauss() throws IOException {
        String resourcePath = "/com/iwhalecloud/byai/manager/mapper/resource/SsResExtDigEmployeeMapper.xml";
        try (var input = getClass().getResourceAsStream(resourcePath)) {
            assertThat(input).isNotNull();
            String mapperXml = new String(input.readAllBytes(), StandardCharsets.UTF_8);
            int queryStart = mapperXml.indexOf("<select id=\"selectEmployeeGroupMemberCandidates\"");
            int queryEnd = mapperXml.indexOf("</select>", queryStart);
            assertThat(queryStart).isGreaterThanOrEqualTo(0);
            assertThat(queryEnd).isGreaterThan(queryStart);
            String candidateQuery = mapperXml.substring(queryStart, queryEnd);

            assertThat(candidateQuery).contains("length(trim(a.resource_code)) > 0")
                .contains("length(trim(a.resource_name)) > 0")
                .contains("length(trim(a.worker_agent_type)) > 0")
                .doesNotContain("trim(a.resource_code) != ''")
                .doesNotContain("trim(a.resource_name) != ''")
                .doesNotContain("trim(a.worker_agent_type) != ''");
        }
    }

    @Test
    void installTargetQuery_limitsManagePermissionToCreatorExplicitGrantAndAdminVip() throws IOException {
        String resourcePath = "/com/iwhalecloud/byai/manager/mapper/resource/SsResExtDigEmployeeMapper.xml";
        try (var input = getClass().getResourceAsStream(resourcePath)) {
            assertThat(input).isNotNull();
            String mapperXml = new String(input.readAllBytes(), StandardCharsets.UTF_8);
            int queryStart = mapperXml.indexOf("<select id=\"selectInstallTargetEmployees\"");
            int queryEnd = mapperXml.indexOf("</select>", queryStart);
            assertThat(queryStart).isGreaterThanOrEqualTo(0);
            assertThat(queryEnd).isGreaterThan(queryStart);
            String query = mapperXml.substring(queryStart, queryEnd);

            assertThat(query).contains("a.owner_type = 'enterprise'")
                .contains("a.owner_type = 'personal'")
                .contains("a.owner_type = 'personal_default'")
                .contains("grant_type = 'ALLOW_MANAGE'")
                .contains("a.create_by = #{userId}")
                .contains("installTargetAdminVip == true")
                .contains("manage_auth.allow_manage_count > 0")
                .contains("manage_auth.black_count = 0")
                .contains("upper(a.resource_name)")
                .contains("upper(a.resource_desc)")
                .contains("coalesce(e.agent_type, '') != '017'")
                .doesNotContain("memberCandidateGlobalManager == true")
                .doesNotContain("managerOrgPathCodes")
                .doesNotContain("grant_type in ('AVAILABLE_USE', 'FORCE_USE'");
        }
    }
}
