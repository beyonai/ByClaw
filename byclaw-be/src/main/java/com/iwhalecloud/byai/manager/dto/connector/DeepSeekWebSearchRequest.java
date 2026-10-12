package com.iwhalecloud.byai.manager.dto.connector;

import java.util.List;

public record DeepSeekWebSearchRequest(String query, List<String> queries, Integer maxResults, String requestId) {
}
