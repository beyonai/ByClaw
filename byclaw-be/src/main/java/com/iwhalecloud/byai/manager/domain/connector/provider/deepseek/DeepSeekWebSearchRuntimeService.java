package com.iwhalecloud.byai.manager.domain.connector.provider.deepseek;

import com.iwhalecloud.byai.common.i18n.I18nUtil;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorConnectionStateService;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorInfoService;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorManifestService;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class DeepSeekWebSearchRuntimeService {
    private static final Logger log = LoggerFactory.getLogger(DeepSeekWebSearchRuntimeService.class);
    public static final String CONNECTOR_CODE = "deepseek-web-search";
    public static final String GLOBAL_API_KEY_CONFIG = "WEB_SEARCH_APIKEY";
    private static final int MAX_RESULTS = 20;
    private static final int MAX_QUERY_LENGTH = 2000;
    private static final int MAX_QUERIES = 4;

    private final ConnectorInfoService connectorInfoService;
    private final ConnectorConnectionStateService connectionStateService;
    private final ConnectorManifestService manifestService;
    private final DeepSeekWebSearchClient client;
    private final DeepSeekWebSearchBatchExecutor batchExecutor;
    private final ByaiSystemConfigService systemConfigService;
    private final ObjectMapper objectMapper;

    public DeepSeekWebSearchRuntimeService(
            ConnectorInfoService connectorInfoService,
            ConnectorConnectionStateService connectionStateService,
            ConnectorManifestService manifestService,
            DeepSeekWebSearchClient client,
            DeepSeekWebSearchBatchExecutor batchExecutor,
            ByaiSystemConfigService systemConfigService,
            ObjectMapper objectMapper) {
        this.connectorInfoService = connectorInfoService;
        this.connectionStateService = connectionStateService;
        this.manifestService = manifestService;
        this.client = client;
        this.batchExecutor = batchExecutor;
        this.systemConfigService = systemConfigService;
        this.objectMapper = objectMapper;
    }

    public DeepSeekWebSearchResult search(Long userId, String query, Integer requestedMaxResults) {
        return search(userId, query == null ? null : List.of(query), requestedMaxResults);
    }

    public DeepSeekWebSearchResult search(Long userId, List<String> requestedQueries, Integer requestedMaxResults) {
        List<String> queries = normalizeQueries(requestedQueries);
        if (userId == null) {
            throw new IllegalArgumentException(I18nUtil.get("connector.deepseek.search.request.invalid"));
        }
        int maxResults = requestedMaxResults == null ? 10 : requestedMaxResults;
        if (maxResults < 1 || maxResults > MAX_RESULTS) {
            throw new IllegalArgumentException(I18nUtil.get("connector.deepseek.search.max.results.invalid", MAX_RESULTS));
        }
        ConnectorInfo connector = connectorInfoService.findByCode(CONNECTOR_CODE);
        requireConnectorEnabled(connector);
        String personalApiKey = personalApiKey(userId, connector);
        if (personalApiKey != null) {
            DeepSeekWebSearchResult personalResult = null;
            try {
                personalResult = execute(connector, personalApiKey, queries, maxResults);
            } catch (DeepSeekWebSearchException e) {
                log.warn(
                    "DeepSeek personal web search failed; falling back to platform credential: "
                        + "connectorCode={}, userId={}, errorCode={}",
                    CONNECTOR_CODE, userId, e.getErrorCode(), e);
            }
            if (personalResult != null) {
                requireConnectorEnabled(connectorInfoService.findByCode(CONNECTOR_CODE));
                log.debug("DeepSeek web search completed with personal credential: connectorCode={}, userId={}",
                    CONNECTOR_CODE, userId);
                return personalResult;
            }
        }
        String globalApiKey = globalApiKey();
        if (globalApiKey == null) {
            throw authorizationRequired();
        }
        DeepSeekWebSearchResult globalResult;
        try {
            globalResult = execute(connector, globalApiKey, queries, maxResults);
        } catch (DeepSeekWebSearchException e) {
            log.warn(
                "DeepSeek platform web search failed: connectorCode={}, userId={}, errorCode={}",
                CONNECTOR_CODE, userId, e.getErrorCode(), e);
            throw authorizationRequired();
        }
        requireConnectorEnabled(connectorInfoService.findByCode(CONNECTOR_CODE));
        log.debug("DeepSeek web search completed with platform credential: connectorCode={}, userId={}",
            CONNECTOR_CODE, userId);
        return globalResult;
    }

    private List<String> normalizeQueries(List<String> requestedQueries) {
        if (requestedQueries == null || requestedQueries.isEmpty()) {
            throw new IllegalArgumentException(I18nUtil.get("connector.deepseek.search.queries.required"));
        }
        if (requestedQueries.size() > MAX_QUERIES) {
            throw new IllegalArgumentException(I18nUtil.get("connector.deepseek.search.queries.limit", MAX_QUERIES));
        }
        LinkedHashSet<String> queries = new LinkedHashSet<>();
        for (String query : requestedQueries) {
            String normalized = query == null ? "" : query.trim();
            if (normalized.isEmpty() || normalized.length() > MAX_QUERY_LENGTH) {
                throw new IllegalArgumentException(I18nUtil.get("connector.deepseek.search.query.invalid"));
            }
            queries.add(normalized);
        }
        return List.copyOf(queries);
    }

    private DeepSeekWebSearchResult execute(
            ConnectorInfo connector, String apiKey, List<String> queries, int maxResults) {
        return queries.size() == 1
            ? client.search(connector, apiKey, queries.getFirst(), maxResults)
            : batchExecutor.search(connector, apiKey, queries, maxResults);
    }

    private String personalApiKey(Long userId, ConnectorInfo connector) {
        ConnectorAuth authorization = connectionStateService.findActiveAuthorization(
            String.valueOf(userId), connector.getConnectorId());
        if (authorization == null) {
            log.debug("No personal DeepSeek authorization found; platform fallback will be used: "
                + "connectorCode={}, userId={}", CONNECTOR_CODE, userId);
            return null;
        }
        if (!personalAuthorizationUsable(authorization)) {
            log.debug("Personal DeepSeek authorization is not usable; platform fallback will be used: "
                    + "connectorCode={}, userId={}, enableFlag={}, statusCd={}, credentialState={}",
                CONNECTOR_CODE, userId, authorization.getEnableFlag(), authorization.getStatusCd(),
                authorization.getCredentialState());
            return null;
        }
        Map<String, String> credentials = manifestService.readManagedCredentials(
            userId, connector, DeepSeekWebSearchCredentialFormProvider.MANAGED_KEYS);
        String apiKey = credentials == null ? null
            : nonBlank(credentials.get(DeepSeekWebSearchCredentialFormProvider.API_KEY));
        if (apiKey == null) {
            log.warn("Personal DeepSeek authorization has no managed API key; platform fallback will be used: "
                + "connectorCode={}, userId={}", CONNECTOR_CODE, userId);
        }
        return apiKey;
    }

    private boolean personalAuthorizationUsable(ConnectorAuth authorization) {
        if (authorization == null || !"Y".equals(authorization.getEnableFlag())
                || !"00A".equals(authorization.getStatusCd())
                || "REAUTH_REQUIRED".equals(authorization.getCredentialState())) {
            return false;
        }
        Date now = new Date();
        return !expired(authorization.getExpireTime(), now)
            && !expired(authorization.getAccessExpireTime(), now);
    }

    private boolean expired(Date expiry, Date now) {
        return expiry != null && !expiry.after(now);
    }

    private String globalApiKey() {
        String configured = nonBlank(systemConfigService.getDcSystemConfigValueByCode(GLOBAL_API_KEY_CONFIG));
        if (configured == null) {
            log.warn("DeepSeek platform credential configuration is missing: configCode={}, connectorCode={}",
                GLOBAL_API_KEY_CONFIG, CONNECTOR_CODE);
            return null;
        }
        try {
            JsonNode root = objectMapper.readTree(configured);
            if (root == null || !root.isObject()) {
                log.warn("Web search platform credential configuration is not a JSON object: configCode={}",
                    GLOBAL_API_KEY_CONFIG);
                return null;
            }
            String value = nonBlank(root.path(CONNECTOR_CODE).asText(null));
            if (value == null) {
                log.warn("DeepSeek platform credential is missing from provider dictionary: "
                    + "configCode={}, connectorCode={}", GLOBAL_API_KEY_CONFIG, CONNECTOR_CODE);
                return null;
            }
            if (value.matches(".*\\$\\{[^}]+}.*")) {
                log.warn("DeepSeek platform credential contains an unresolved environment placeholder: "
                    + "configCode={}, connectorCode={}", GLOBAL_API_KEY_CONFIG, CONNECTOR_CODE);
                return null;
            }
            return value;
        } catch (Exception e) {
            log.warn("Unable to parse web search platform credential configuration: configCode={}, errorType={}",
                GLOBAL_API_KEY_CONFIG, e.getClass().getSimpleName(), sanitizedStackTrace(e));
            return null;
        }
    }

    private RuntimeException sanitizedStackTrace(Exception source) {
        RuntimeException sanitized = new RuntimeException(
            "Credential configuration parsing failed (details redacted)");
        sanitized.setStackTrace(source.getStackTrace());
        return sanitized;
    }

    private String nonBlank(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return value.trim();
    }

    private DeepSeekWebSearchException authorizationRequired() {
        return new DeepSeekWebSearchException(
            "CONNECTOR_NOT_AUTHORIZED", I18nUtil.get("connector.deepseek.search.authorization.required"));
    }

    private void requireConnectorEnabled(ConnectorInfo connector) {
        if (connector == null || connector.getConnectorId() == null || !"00A".equals(connector.getStatusCd())) {
            throw new DeepSeekWebSearchException("CONNECTOR_NOT_ENABLED", I18nUtil.get("connector.deepseek.search.disabled"));
        }
    }
}
