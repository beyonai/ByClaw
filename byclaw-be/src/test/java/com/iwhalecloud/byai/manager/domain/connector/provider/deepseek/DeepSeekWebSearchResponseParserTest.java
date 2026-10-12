package com.iwhalecloud.byai.manager.domain.connector.provider.deepseek;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

class DeepSeekWebSearchResponseParserTest {

    private final DeepSeekWebSearchResponseParser parser =
        new DeepSeekWebSearchResponseParser(new ObjectMapper());

    @Test
    void joinsCitationSnippetsDeduplicatesAndLimitsResults() {
        String json = """
            {
              "content": [
                {
                  "type": "text",
                  "citations": [
                    {"url": "https://a.example", "cited_text": "first excerpt"},
                    {"url": "https://a.example", "cited_text": "ignored excerpt"}
                  ]
                },
                {
                  "type": "web_search_tool_result",
                  "content": [
                    {"type": "web_search_result", "url": "https://a.example", "title": "A", "page_age": "2026-10-01"},
                    {"type": "web_search_result", "url": "https://a.example", "title": "duplicate"},
                    {"type": "web_search_result", "url": "https://b.example", "title": "B"}
                  ]
                }
              ]
            }
            """;

        DeepSeekWebSearchResult result = parser.parse(json, 1);

        assertThat(result.sources()).containsExactly(
            new DeepSeekWebSearchResult.Source(
                "https://a.example", "A", "first excerpt", "2026-10-01"));
        assertThat(result.truncated()).isTrue();
    }

    @Test
    void rejectsProseOnlyResponses() {
        assertThatThrownBy(() -> parser.parse("{\"content\":[{\"type\":\"text\",\"text\":\"answer\"}]}", 5))
            .isInstanceOf(DeepSeekWebSearchException.class)
            .hasMessageContaining("DEEPSEEK_WEB_SEARCH_PROTOCOL_ERROR");
    }

    @Test
    void rejectsInvalidResultLimit() {
        assertThatThrownBy(() -> parser.parse("{}", 0))
            .isInstanceOf(IllegalArgumentException.class);
    }
}
