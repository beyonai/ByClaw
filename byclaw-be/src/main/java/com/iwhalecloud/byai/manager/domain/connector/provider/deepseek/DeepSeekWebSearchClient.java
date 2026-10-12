package com.iwhalecloud.byai.manager.domain.connector.provider.deepseek;

import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;

public interface DeepSeekWebSearchClient {
    DeepSeekWebSearchResult search(ConnectorInfo connector, String apiKey, String query, int maxResults);
}
