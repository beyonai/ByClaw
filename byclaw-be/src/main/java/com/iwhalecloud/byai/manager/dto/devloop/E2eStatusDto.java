package com.iwhalecloud.byai.manager.dto.devloop;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

import java.util.List;

/**
 * 集成测试结果真相源 status.json,契约见规范页 /spec/integrationTest(前端 pages/spec/contracts.ts)。
 * 平台按此约定读,用例集/员工按此约定写;字段 camelCase,多余字段忽略以容纳规范未来扩展。
 */
@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class E2eStatusDto {

    private Integer schemaVersion;

    /** 封闭枚举:pending/preparing/running/passed/failed/error/timeout/cancelled。 */
    private String status;

    private String startedAt;

    /** 心跳:运行中定期刷新。 */
    private String updatedAt;

    /** 仅终态非空。 */
    private String finishedAt;

    private Totals totals;

    private List<Suite> suites;

    /** 打回原因,非失败可空。 */
    private String reason;

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Totals {

        private Integer total;

        private Integer passed;

        private Integer failed;

        private Integer skipped;

        /**
         * 算平后的用例总数。实测数字员工会把测试框架尾行的 passed 数当 total 填(如 pytest
         * 「60 passed, 1 skipped」写成 total=60),导致 total < passed+skipped 自相矛盾。
         * 分项是逐条数出来的,比 total 可信,故不一致时以分项之和为准。
         */
        public int reconciledTotal() {
            int sum = nz(passed) + nz(failed) + nz(skipped);
            return nz(total) == sum ? nz(total) : sum;
        }

        private static int nz(Integer v) {
            return v == null ? 0 : v;
        }
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Suite {

        private String id;

        private String status;

        /** JUnit XML 相对结果根目录的路径,如 reports/suite-api.xml。 */
        private String report;

        /** 运行日志相对路径,如 logs/suite-api.log。 */
        private String log;

        private List<FailedCase> failedCases;
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class FailedCase {

        /** 用例标识。规范页 JSON 字段名是 case(Java 关键字),故显式映射。 */
        @JsonProperty("case")
        private String caseName;

        private String message;

        /** 失败证据相对路径,如 artifacts/suite-web/test_login.png。 */
        private List<String> artifacts;
    }
}
