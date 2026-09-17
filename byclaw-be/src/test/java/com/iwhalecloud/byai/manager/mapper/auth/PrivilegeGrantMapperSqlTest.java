package com.iwhalecloud.byai.manager.mapper.auth;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

import org.junit.jupiter.api.Test;

/** 校验审核中心查询为前端历史列表提供稳定的审核结果和处理时间字段。 */
class PrivilegeGrantMapperSqlTest {

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
                .contains("and pg.status_cd in ('X', 'R')");
        }
    }
}
