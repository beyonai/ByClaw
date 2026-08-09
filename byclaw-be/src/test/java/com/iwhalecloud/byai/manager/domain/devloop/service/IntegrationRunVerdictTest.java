package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.iwhalecloud.byai.manager.entity.devloop.IntegrationSuite;
import com.iwhalecloud.byai.manager.domain.devloop.service.IntegrationRunExecutor.JunitSummary;
import com.iwhalecloud.byai.manager.domain.devloop.service.IntegrationRunExecutor.RunVerdict;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;

/**
 * 集成测试「成功」的判定标准。重点覆盖:命令退出码 0 但报告没取到时不能判 passed,
 * 否则「一个用例都没跑」和「全部通过」在前端看到的是同一个绿色结果。
 */
class IntegrationRunVerdictTest {

    private static IntegrationSuite suite(String reportPath) {
        IntegrationSuite suite = new IntegrationSuite();
        suite.setSuiteId(1L);
        suite.setSuiteName("byclaw-be 接口回归");
        suite.setReportPath(reportPath);
        return suite;
    }

    @Test
    @DisplayName("命令成功且报告有用例无失败时判通过")
    void passesWhenReportHasCases() {
        JunitSummary summary = new JunitSummary();
        summary.total = 50;
        summary.passed = 50;
        summary.reportResolved = true;

        RunVerdict verdict = IntegrationRunExecutor.decideVerdict(suite("tests/report.xml"), "passed", summary);

        assertThat(verdict.status()).isEqualTo("passed");
        assertThat(verdict.reason()).isNull();
    }

    @Test
    @DisplayName("配了报告路径但报告没取到时判失败，不能因为退出码 0 就算通过")
    void failsWhenReportMissing() {
        JunitSummary summary = new JunitSummary();

        RunVerdict verdict = IntegrationRunExecutor.decideVerdict(suite("tests/report.xml"), "passed", summary);

        assertThat(verdict.status()).isEqualTo("failed");
        assertThat(verdict.reason()).contains("报告缺失或不可解析").contains("tests/report.xml");
    }

    @Test
    @DisplayName("报告能解析但一个用例都没有时同样判失败")
    void failsWhenReportHasNoCases() {
        JunitSummary summary = new JunitSummary();
        summary.reportResolved = true;

        RunVerdict verdict = IntegrationRunExecutor.decideVerdict(suite("tests/report.xml"), "passed", summary);

        assertThat(verdict.status()).isEqualTo("failed");
        assertThat(verdict.reason()).contains("报告缺失或不可解析");
    }

    @Test
    @DisplayName("没配报告路径时仍按命令退出码判定，保持原有行为")
    void keepsExitCodeVerdictWithoutReportPath() {
        JunitSummary summary = new JunitSummary();

        assertThat(IntegrationRunExecutor.decideVerdict(suite(null), "passed", summary).status())
            .isEqualTo("passed");
        assertThat(IntegrationRunExecutor.decideVerdict(suite(null), "failed", summary).status())
            .isEqualTo("failed");
    }

    @Test
    @DisplayName("有失败用例时优先报失败用例数，超时优先于一切")
    void failedCasesAndTimeoutTakePrecedence() {
        JunitSummary summary = new JunitSummary();
        summary.total = 50;
        summary.failed = 2;
        summary.reportResolved = true;

        RunVerdict failed = IntegrationRunExecutor.decideVerdict(suite("tests/report.xml"), "failed", summary);
        assertThat(failed.status()).isEqualTo("failed");
        assertThat(failed.reason()).contains("failed=2");

        RunVerdict timeout = IntegrationRunExecutor.decideVerdict(suite("tests/report.xml"), "timeout", summary);
        assertThat(timeout.status()).isEqualTo("timeout");
        assertThat(timeout.reason()).contains("超时");
    }

    @Test
    @DisplayName("解析真实 pytest JUnit 报告：50 用例全通过并置位 reportResolved")
    void parsesRealPytestReport() throws Exception {
        String xml = """
            <?xml version="1.0" encoding="utf-8"?>
            <testsuites>
              <testsuite name="pytest" errors="0" failures="0" skipped="0" tests="3" time="4.551">
                <testcase classname="suites.byclaw_be.health" name="test_health" time="0.1"/>
                <testcase classname="suites.byclaw_be.chat" name="test_websocket_chat" time="1.668"/>
                <testcase classname="suites.byclaw_be.chat" name="test_sse_chat" time="1.692"/>
              </testsuite>
            </testsuites>
            """;
        JunitSummary summary = new JunitSummary();
        IntegrationRunExecutor.parseJunitXml(xml, suite("tests/report.xml"), summary);

        assertThat(summary.total).isEqualTo(3);
        assertThat(summary.passed).isEqualTo(3);
        assertThat(summary.failed).isZero();
        assertThat(summary.reportResolved).isTrue();
        assertThat(IntegrationRunExecutor.decideVerdict(suite("tests/report.xml"), "passed", summary).status())
            .isEqualTo("passed");
    }

    @Test
    @DisplayName("报告里有 failure 时汇总失败数并带上失败用例")
    void parsesFailedCases() throws Exception {
        String xml = """
            <testsuites>
              <testsuite name="pytest" errors="1" failures="1" skipped="0" tests="4" time="2.0">
                <testcase classname="suites.byclaw_be.auth" name="test_login" time="0.1"/>
                <testcase classname="suites.byclaw_be.auth" name="test_logout" time="0.1">
                  <failure message="assert 401 == 200">boom</failure>
                </testcase>
                <testcase classname="suites.byclaw_be.tool" name="test_tool" time="0.1">
                  <error message="connection refused">boom</error>
                </testcase>
                <testcase classname="suites.byclaw_be.user" name="test_user" time="0.1"/>
              </testsuite>
            </testsuites>
            """;
        JunitSummary summary = new JunitSummary();
        IntegrationRunExecutor.parseJunitXml(xml, suite("tests/report.xml"), summary);

        assertThat(summary.total).isEqualTo(4);
        assertThat(summary.failed).isEqualTo(2);
        assertThat(summary.passed).isEqualTo(2);
        assertThat(summary.suitesJson).contains("suites.byclaw_be.auth#test_logout")
            .contains("suites.byclaw_be.tool#test_tool");
        assertThat(IntegrationRunExecutor.decideVerdict(suite("tests/report.xml"), "failed", summary).reason())
            .contains("failed=2");
    }

    @Test
    @DisplayName("XML 结构坏掉时抛异常，reportResolved 保持 false 从而判失败")
    void brokenXmlLeavesReportUnresolved() {
        JunitSummary summary = new JunitSummary();
        assertThat(summary.reportResolved).isFalse();
        assertThat(IntegrationRunExecutor.decideVerdict(suite("tests/report.xml"), "passed", summary).status())
            .isEqualTo("failed");
    }

    @Test
    @DisplayName("尾部截断的报告解析失败:CommandRunner 的日志态截断砍掉 XML 声明")
    void truncatedReportIsUnparseable() {
        String truncated = "...[truncated]...\n"
            + "<testcase classname=\"suites.byclaw_be.health\" name=\"test_ok\" time=\"0.1\" />\n"
            + "</testsuite></testsuites>";
        JunitSummary summary = new JunitSummary();
        assertThat(catchThrowable(() -> IntegrationRunExecutor.parseJunitXml(truncated, suite("r.xml"), summary)))
            .isNotNull();
        assertThat(summary.reportResolved).isFalse();
    }

    @Test
    @DisplayName("根标签后追加 stderr 的报告解析失败:输出合并会污染 XML 尾部")
    void reportWithTrailingStderrIsUnparseable() {
        String polluted = """
            <?xml version="1.0" encoding="utf-8"?>
            <testsuites><testsuite name="pytest" tests="1" failures="0" errors="0" skipped="0" time="0.1">
            <testcase classname="suites.byclaw_be.health" name="test_ok" time="0.1" />
            </testsuite></testsuites>
            Warning: Permanently added host to the list of known hosts.
            """;
        JunitSummary summary = new JunitSummary();
        assertThat(catchThrowable(() -> IntegrationRunExecutor.parseJunitXml(polluted, suite("r.xml"), summary)))
            .isNotNull();
        assertThat(summary.reportResolved).isFalse();
    }

    @Test
    @DisplayName("解析失败原因回显进打回理由,不再只有一句「报告缺失」")
    void reportErrorSurfacesInVerdictReason() {
        JunitSummary summary = new JunitSummary();
        summary.reportError = "报告解析失败:tests/report.xml (Content is not allowed in prolog.)";
        RunVerdict verdict = IntegrationRunExecutor.decideVerdict(suite("tests/report.xml"), "passed", summary);
        assertThat(verdict.status()).isEqualTo("failed");
        assertThat(verdict.reason()).startsWith("报告解析失败:tests/report.xml").endsWith("无法确认用例是否执行");
    }
}
