package com.iwhalecloud.byai.manager.domain.connector.provider.media;

import java.util.List;
import java.util.Map;

public record MediaModelConfig(
    int schemaVersion,
    String revision,
    String connectorCode,
    String modelName,
    String modelCode,
    MediaModelType modelType,
    String modelProtocol,
    String apiEndpoint,
    String apiToken,
    List<MediaModelHeader> headers,
    int connectTimeoutSeconds,
    int readTimeoutSeconds,
    int maxRetryCount,
    int retryIntervalSeconds,
    Map<String, Object> options
) {
    public MediaModelConfig {
        headers = headers == null ? List.of() : List.copyOf(headers);
        options = options == null ? Map.of() : Map.copyOf(options);
    }
}
