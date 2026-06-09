package com.iwhalecloud.byai.manager.application.service.ecosystem;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class OpenCliCapabilityServiceTest {

    @Test
    void extractJsonArrayPayload_ignoresOpenCliUpdateNotice() {
        String output = """
            [
              {
                "site": "zhihu",
                "name": "download",
                "description": "导出知乎文章为 Markdown 格式",
                "args": [
                  {
                    "name": "url",
                    "help": "Article URL [zhuanlan]"
                  }
                ]
              }
            ]

              Update available: v1.8.0 -> v1.8.1
              Run: npm install -g @jackwener/opencli
            """;

        assertThat(OpenCliCapabilityService.extractJsonArrayPayload(output)).isEqualTo("""
            [
              {
                "site": "zhihu",
                "name": "download",
                "description": "导出知乎文章为 Markdown 格式",
                "args": [
                  {
                    "name": "url",
                    "help": "Article URL [zhuanlan]"
                  }
                ]
              }
            ]""");
    }

    @Test
    void extractJsonArrayPayload_returnsEmptyWhenNoCompleteArrayExists() {
        assertThat(OpenCliCapabilityService.extractJsonArrayPayload("Update available")).isEmpty();
        assertThat(OpenCliCapabilityService.extractJsonArrayPayload("[{\"site\":\"zhihu\"}")).isEmpty();
    }
}
