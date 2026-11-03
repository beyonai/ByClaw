package com.iwhalecloud.byai.manager.application.service.resource;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.assertj.core.api.Assertions.assertThat;

class SkillPublicationNamesTest {
    @ParameterizedTest
    @CsvSource({"report, report_企业", "数据分析, 数据分析_企业", "report_企业, report_企业",
        "report(企业), report_企业", "report(Enterprise), report_企业", "report（企业）, report_企业",
        "销售 分析（日报）, 销售_分析_日报_企业", "a--b, a_b_企业", "a_-b, a_b_企业",
        "My-report_1, My-report_1_企业"})
    void usesOneStableEnterpriseSuffix(String source, String expected) {
        assertThat(SkillPublicationNames.enterpriseName(source)).isEqualTo(expected);
    }

    @ParameterizedTest
    @CsvSource({"report, 张三, report_张三_企业", "report_企业, User001, report_User001_企业",
        "report, 张三（测试）, report_张三_测试_企业"})
    void disambiguatesWithPublisherWithoutParenthesesOrPathCharacters(String source, String publisher, String expected) {
        assertThat(SkillPublicationNames.enterpriseName(source, publisher)).isEqualTo(expected);
    }
}
