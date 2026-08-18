package com.iwhalecloud.byai.manager.domain.devloop.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * 锁定 byai_scan_log.error_msg 的截断口径。 该列是 VARCHAR(1000)，openGauss 按字节计长，而 StringUtils.abbreviate 按字符计长：
 * 中文异常信息 1000 字符 = 3000 字节，会以 value too long for type character varying(1000) 插入失败。
 */
class ScanLogErrorMsgTruncationTest {

    private String abbreviate(String errorMsg) {
        return (String) ReflectionTestUtils.invokeMethod(new ScanLogService(), "abbreviateByBytes", errorMsg, 1000);
    }

    private int utf8Bytes(String value) {
        return value.getBytes(StandardCharsets.UTF_8).length;
    }

    @Test
    void chineseMessageIsTruncatedByBytesNotCharacters() {
        // 900 个中文字符 = 2700 字节：字符数没超但字节数远超，正是线上报错的形态。
        String errorMsg = "无".repeat(900);

        String truncated = abbreviate(errorMsg);

        assertThat(utf8Bytes(truncated)).isLessThanOrEqualTo(1000);
        assertThat(truncated).isNotEmpty();
    }

    @Test
    void shortMessageStaysIntact() {
        String errorMsg = "无法加载创建者登录信息，本次未执行";

        assertThat(abbreviate(errorMsg)).isEqualTo(errorMsg);
    }

    @Test
    void asciiMessageKeepsFullByteBudget() {
        String errorMsg = "e".repeat(1500);

        String truncated = abbreviate(errorMsg);

        // 单字节字符可以正好用满 1000 字节，不该被多截。
        assertThat(truncated).hasSize(1000);
    }

    @Test
    void surrogatePairIsNeverSplitInHalf() {
        // 每个 emoji 是一对代理项、4 字节，251 个刚好越过 1000 字节边界。
        String errorMsg = "😀".repeat(251);

        String truncated = abbreviate(errorMsg);

        assertThat(utf8Bytes(truncated)).isLessThanOrEqualTo(1000);
        // 截出来的串必须仍是合法字符序列：长度为偶数且不以孤立高代理项结尾。
        assertThat(truncated.length() % 2).isZero();
        assertThat(Character.isHighSurrogate(truncated.charAt(truncated.length() - 1))).isFalse();
    }

    @Test
    void titleColumnUsesItsOwnNarrowerByteBudget() {
        // 自动化名称写进 byai_scan_log_item.title，那列是 VARCHAR(500)，比 error_msg 更窄。
        String sourceName = "每日巡检".repeat(60);

        String truncated = (String) ReflectionTestUtils.invokeMethod(new ScanLogService(), "abbreviateByBytes",
            sourceName, 500);

        assertThat(utf8Bytes(truncated)).isLessThanOrEqualTo(500);
    }

    @Test
    void nullAndEmptyAreLeftAlone() {
        assertThat(abbreviate(null)).isNull();
        assertThat(abbreviate("")).isEmpty();
    }
}
