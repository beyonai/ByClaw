package com.iwhalecloud.byai.state.domain.groupchat.integration;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

/** 有界公开摘要只使用当前消息的明确资源快照，不携带原始富文本与链接目标。 */
class WorkgroupMessagePreviewTest {
    /** 完整资源键精确替换全部命中项，普通文字和未命中的引用不猜测身份。 */
    @Test
    void resolvesExactResourceSnapshotsAndProducesPlainSingleLineText() throws Exception {
        var resources = new ObjectMapper().readTree("""
            [{"id":"HUMAN_22","resourceType":"HUMAN","resourceName":"小刘"},
             {"id":"FILE_1","resourceType":"FILE","resourceName":"计划"}]
            """);
        var preview = new WorkgroupMessagePreview("研发群", "刘皇叔", "USER",
            "<b>你好</b>\n{{HUMAN_22}} {{HUMAN_22}} {{FILE_1}} {{HUMAN_23}} "
                + "[详情](https://example.com/private) <script>hidden content</script>", resources, false);
        assertThat(preview.getText()).isEqualTo("你好 @小刘 @小刘 #计划 {{HUMAN_23}} 详情");
        assertThat(preview.getText()).doesNotContain("https://", "hidden content", "<b>", "\n");
    }

    /** 按码点截断可保留完整 emoji，不让长名称或正文突破传输上限。 */
    @Test
    void boundsNamesAndContentWithoutSplittingSurrogatePairs() {
        var preview = new WorkgroupMessagePreview("群".repeat(80), "名".repeat(40), "AGENT",
            "😀".repeat(200), null, true);
        assertThat(preview.getGroupName().codePointCount(0, preview.getGroupName().length())).isEqualTo(64);
        assertThat(preview.getSenderName().codePointCount(0, preview.getSenderName().length())).isEqualTo(32);
        assertThat(preview.getText()).isEqualTo("😀".repeat(159) + "…");
        assertThat(preview.isAttachments()).isTrue();
    }
}
