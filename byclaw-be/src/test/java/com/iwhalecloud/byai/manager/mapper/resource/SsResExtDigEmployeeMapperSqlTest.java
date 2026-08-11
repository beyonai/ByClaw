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
}
