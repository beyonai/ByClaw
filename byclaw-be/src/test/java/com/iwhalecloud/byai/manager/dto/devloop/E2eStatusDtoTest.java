package com.iwhalecloud.byai.manager.dto.devloop;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * status.json 解析与计数算平。契约见规范页 /spec/integrationTest,平台按此约定读结果,
 * 用例集/测试员工按此约定写;字段名对不上就等于没回流,故用规范页原样 JSON 做输入。
 */
class E2eStatusDtoTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    @DisplayName("按规范页原样 JSON 解析出状态、计数、报告路径与带截图的失败用例")
    void parsesSpecShapedJson() throws Exception {
        String json = """
            {
              "schemaVersion": 1,
              "status": "failed",
              "startedAt": "2026-08-07T09:30:00+08:00",
              "finishedAt": "2026-08-07T09:41:12+08:00",
              "totals": { "total": 18, "passed": 15, "failed": 3, "skipped": 0 },
              "suites": [
                { "id": "suite-web", "status": "failed", "report": "reports/suite-web.xml",
                  "log": "logs/suite-web.log",
                  "failedCases": [
                    { "case": "test_login", "message": "鉴权头丢失",
                      "artifacts": ["artifacts/suite-web/test_login.png"] }
                  ] }
              ],
              "reason": "登录用例 3 条失败"
            }
            """;

        E2eStatusDto dto = mapper.readValue(json, E2eStatusDto.class);

        assertThat(dto.getStatus()).isEqualTo("failed");
        assertThat(dto.getReason()).isEqualTo("登录用例 3 条失败");
        assertThat(dto.getTotals().getTotal()).isEqualTo(18);
        assertThat(dto.getSuites()).hasSize(1);
        E2eStatusDto.Suite suite = dto.getSuites().get(0);
        assertThat(suite.getReport()).isEqualTo("reports/suite-web.xml");
        assertThat(suite.getLog()).isEqualTo("logs/suite-web.log");
        // case 是 Java 关键字,靠 @JsonProperty 映射;映射掉了失败用例名就全空。
        assertThat(suite.getFailedCases().get(0).getCaseName()).isEqualTo("test_login");
        assertThat(suite.getFailedCases().get(0).getArtifacts())
            .containsExactly("artifacts/suite-web/test_login.png");
    }

    @Test
    @DisplayName("员工附带规范未定义的字段时不报错,忽略即可")
    void ignoresUnknownFields() throws Exception {
        String json = "{\"status\":\"passed\",\"totals\":{\"total\":1,\"passed\":1},\"extra\":{\"a\":1}}";

        E2eStatusDto dto = mapper.readValue(json, E2eStatusDto.class);

        assertThat(dto.getStatus()).isEqualTo("passed");
        assertThat(dto.getTotals().getPassed()).isEqualTo(1);
    }

    @Test
    @DisplayName("total 与分项一致时原样返回")
    void keepsTotalWhenConsistent() {
        assertThat(totals(61, 60, 0, 1).reconciledTotal()).isEqualTo(61);
    }

    @Test
    @DisplayName("员工把框架尾行的 passed 数当 total 时,按分项之和纠正")
    void reconcilesWhenTotalMissesSkipped() {
        // 实测回流:pytest 尾行「60 passed, 1 skipped」被写成 total=60,真实总数是 61。
        assertThat(totals(60, 60, 0, 1).reconciledTotal()).isEqualTo(61);
    }

    @Test
    @DisplayName("计数字段缺失按 0 计,不抛空指针")
    void treatsMissingCountsAsZero() {
        E2eStatusDto.Totals totals = new E2eStatusDto.Totals();
        totals.setPassed(3);

        assertThat(totals.reconciledTotal()).isEqualTo(3);
    }

    private static E2eStatusDto.Totals totals(int total, int passed, int failed, int skipped) {
        E2eStatusDto.Totals t = new E2eStatusDto.Totals();
        t.setTotal(total);
        t.setPassed(passed);
        t.setFailed(failed);
        t.setSkipped(skipped);
        return t;
    }
}
