package com.iwhalecloud.byai.state.interfaces.controller.resource;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class ToolManControllerTest {

    @Test
    void sanitizeDownloadUrlForLogRemovesCredentialsQueryAndFragment() {
        assertThat(ToolManController.sanitizeDownloadUrlForLog(
            "https://user:secret@example.com/skills/demo.zip?skillIds=123&token=secret#fragment"))
            .isEqualTo("https://example.com/skills/demo.zip");
    }

    @Test
    void sanitizeDownloadUrlForLogHandlesBlankAndInvalidValues() {
        assertThat(ToolManController.sanitizeDownloadUrlForLog(null)).isEmpty();
        assertThat(ToolManController.sanitizeDownloadUrlForLog("not-a-url")).isEqualTo("[invalid-url]");
    }
}
