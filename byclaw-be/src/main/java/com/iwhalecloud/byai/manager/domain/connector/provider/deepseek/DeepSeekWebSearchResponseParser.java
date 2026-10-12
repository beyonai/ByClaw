package com.iwhalecloud.byai.manager.domain.connector.provider.deepseek;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class DeepSeekWebSearchResponseParser {
    private static final String PROTOCOL_ERROR = "DEEPSEEK_WEB_SEARCH_PROTOCOL_ERROR";

    private final ObjectMapper objectMapper;

    public DeepSeekWebSearchResponseParser(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public DeepSeekWebSearchResult parse(String responseBody, int maxResults) {
        if (maxResults <= 0) {
            throw new IllegalArgumentException("maxResults must be positive");
        }
        try {
            JsonNode content = objectMapper.readTree(responseBody).path("content");
            if (!content.isArray()) {
                throw protocolError("response content is missing");
            }
            Map<String, String> snippets = citationSnippets(content);
            List<DeepSeekWebSearchResult.Source> sources = new ArrayList<>();
            Set<String> seen = new LinkedHashSet<>();
            boolean hasResultBlock = false;
            for (JsonNode block : content) {
                if (!"web_search_tool_result".equals(text(block, "type"))) {
                    continue;
                }
                hasResultBlock = true;
                JsonNode items = block.path("content");
                if (!items.isArray()) {
                    continue;
                }
                for (JsonNode item : items) {
                    String url = text(item, "url");
                    if (!"web_search_result".equals(text(item, "type")) || url == null || !seen.add(url)) {
                        continue;
                    }
                    sources.add(new DeepSeekWebSearchResult.Source(
                        url, text(item, "title"), snippets.get(url), text(item, "page_age")));
                }
            }
            if (!hasResultBlock) {
                throw protocolError("native web search returned no result block");
            }
            boolean truncated = sources.size() > maxResults;
            List<DeepSeekWebSearchResult.Source> limited = truncated
                ? sources.subList(0, maxResults)
                : sources;
            return new DeepSeekWebSearchResult(limited, truncated);
        } catch (DeepSeekWebSearchException e) {
            throw e;
        } catch (Exception e) {
            throw new DeepSeekWebSearchException(PROTOCOL_ERROR, "response body is invalid", e);
        }
    }

    private Map<String, String> citationSnippets(JsonNode content) {
        Map<String, String> snippets = new LinkedHashMap<>();
        for (JsonNode block : content) {
            if (!"text".equals(text(block, "type")) || !block.path("citations").isArray()) {
                continue;
            }
            for (JsonNode citation : block.path("citations")) {
                String url = text(citation, "url");
                String snippet = text(citation, "cited_text");
                if (url != null && snippet != null) {
                    snippets.putIfAbsent(url, snippet);
                }
            }
        }
        return snippets;
    }

    private String text(JsonNode node, String field) {
        JsonNode value = node.path(field);
        if (!value.isTextual() || value.textValue().isBlank()) {
            return null;
        }
        return value.textValue();
    }

    private DeepSeekWebSearchException protocolError(String message) {
        return new DeepSeekWebSearchException(PROTOCOL_ERROR, message);
    }
}
