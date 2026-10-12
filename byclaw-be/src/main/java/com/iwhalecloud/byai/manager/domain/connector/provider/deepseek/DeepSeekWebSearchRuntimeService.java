package com.iwhalecloud.byai.manager.domain.connector.provider.deepseek;

import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorConnectionStateService;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorInfoService;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorManifestService;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

@Service
public class DeepSeekWebSearchRuntimeService {
    public static final String CONNECTOR_CODE = "deepseek-web-search";
    private static final int MAX_RESULTS = 20;
    private static final int MAX_QUERY_LENGTH = 2000;
    private static final int MAX_QUERIES = 4;

    private final ConnectorInfoService connectorInfoService;
    private final ConnectorConnectionStateService connectionStateService;
    private final ConnectorManifestService manifestService;
    private final DeepSeekWebSearchClient client;
    private final DeepSeekWebSearchBatchExecutor batchExecutor;

    public DeepSeekWebSearchRuntimeService(
            ConnectorInfoService connectorInfoService,
            ConnectorConnectionStateService connectionStateService,
            ConnectorManifestService manifestService,
            DeepSeekWebSearchClient client,
            DeepSeekWebSearchBatchExecutor batchExecutor) {
        this.connectorInfoService = connectorInfoService;
        this.connectionStateService = connectionStateService;
        this.manifestService = manifestService;
        this.client = client;
        this.batchExecutor = batchExecutor;
    }

    public DeepSeekWebSearchResult search(Long userId, String query, Integer requestedMaxResults) {
        return search(userId, query == null ? null : List.of(query), requestedMaxResults);
    }

    public DeepSeekWebSearchResult search(Long userId, List<String> requestedQueries, Integer requestedMaxResults) {
        List<String> queries = normalizeQueries(requestedQueries);
        if (userId == null) {
            throw new IllegalArgumentException("DeepSeek web search request is invalid");
        }
        int maxResults = requestedMaxResults == null ? 10 : requestedMaxResults;
        if (maxResults < 1 || maxResults > MAX_RESULTS) {
            throw new IllegalArgumentException("maxResults must be between 1 and " + MAX_RESULTS);
        }
        ConnectorInfo connector = connectorInfoService.findByCode(CONNECTOR_CODE);
        requireEnabled(userId, connector);
        Map<String, String> credentials = manifestService.readManagedCredentials(
            userId, connector, DeepSeekWebSearchCredentialFormProvider.MANAGED_KEYS);
        String apiKey = credentials.get(DeepSeekWebSearchCredentialFormProvider.API_KEY);
        if (apiKey == null || apiKey.isBlank()) {
            throw new DeepSeekWebSearchException("CONNECTOR_CREDENTIAL_MISSING", "API key is unavailable");
        }
        DeepSeekWebSearchResult result = queries.size() == 1
            ? client.search(connector, apiKey, queries.getFirst(), maxResults)
            : batchExecutor.search(connector, apiKey, queries, maxResults);
        requireEnabled(userId, connector);
        return result;
    }

    private List<String> normalizeQueries(List<String> requestedQueries) {
        if (requestedQueries == null || requestedQueries.isEmpty()) {
            throw new IllegalArgumentException("queries must contain at least one query");
        }
        if (requestedQueries.size() > MAX_QUERIES) {
            throw new IllegalArgumentException("queries must contain at most " + MAX_QUERIES + " queries");
        }
        LinkedHashSet<String> queries = new LinkedHashSet<>();
        for (String query : requestedQueries) {
            String normalized = query == null ? "" : query.trim();
            if (normalized.isEmpty() || normalized.length() > MAX_QUERY_LENGTH) {
                throw new IllegalArgumentException("each query must be a non-empty string up to 2000 characters");
            }
            queries.add(normalized);
        }
        return List.copyOf(queries);
    }

    private void requireEnabled(Long userId, ConnectorInfo connector) {
        if (connector == null || connector.getConnectorId() == null || !"00A".equals(connector.getStatusCd())) {
            throw new DeepSeekWebSearchException("CONNECTOR_NOT_ENABLED", "DeepSeek Web Search is disabled");
        }
        ConnectorAuth authorization = connectionStateService.findActiveAuthorization(
            String.valueOf(userId), connector.getConnectorId());
        if (authorization == null) {
            throw new DeepSeekWebSearchException(
                "CONNECTOR_NOT_AUTHORIZED", "DeepSeek Web Search authorization is required");
        }
        if (!"Y".equals(authorization.getEnableFlag())) {
            throw new DeepSeekWebSearchException("CONNECTOR_NOT_ENABLED", "DeepSeek Web Search is disabled");
        }
    }
}
