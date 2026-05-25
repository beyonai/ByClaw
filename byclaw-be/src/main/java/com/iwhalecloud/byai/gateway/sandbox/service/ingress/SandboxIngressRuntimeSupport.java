package com.iwhalecloud.byai.gateway.sandbox.service.ingress;

import okhttp3.HttpUrl;
import okhttp3.Request;

public interface SandboxIngressRuntimeSupport {

    boolean supports(String storageType);

    String baseUrl();

    void customizeRequest(Request.Builder requestBuilder, SandboxIngressRequestContext requestContext);

    default HttpUrl buildTargetUrl(String upstreamEndpoint, String requestPath, String queryString) {
        String baseUrl = baseUrl();
        if ((upstreamEndpoint == null || upstreamEndpoint.isBlank())
            || (!upstreamEndpoint.startsWith("http://") && !upstreamEndpoint.startsWith("https://")
            && (baseUrl == null || baseUrl.isBlank()))) {
            throw new IllegalStateException("sandbox ingress baseUrl is not configured");
        }
        String normalizedEndpoint = upstreamEndpoint.startsWith("http://") || upstreamEndpoint.startsWith("https://")
            ? upstreamEndpoint
            : trimTrailingSlash(baseUrl) + normalizeRelativePath(upstreamEndpoint);
        String[] endpointAndQuery = normalizedEndpoint.split("\\?", 2);
        String pathBase = trimTrailingSlash(endpointAndQuery[0]);
        String normalizedPath = normalizeRequestPath(requestPath);
        StringBuilder url = new StringBuilder(pathBase).append(normalizedPath);
        String existingQuery = endpointAndQuery.length > 1 ? endpointAndQuery[1] : "";
        if (!existingQuery.isBlank() || (queryString != null && !queryString.isBlank())) {
            url.append('?');
            if (!existingQuery.isBlank()) {
                url.append(existingQuery);
            }
            if (queryString != null && !queryString.isBlank()) {
                if (!existingQuery.isBlank()) {
                    url.append('&');
                }
                url.append(queryString);
            }
        }
        HttpUrl targetUrl = HttpUrl.parse(url.toString());
        if (targetUrl == null) {
            throw new IllegalArgumentException("Invalid sandbox ingress target URL: " + url);
        }
        return targetUrl;
    }

    private static String trimTrailingSlash(String value) {
        if (value == null || value.isBlank() || "/".equals(value)) {
            return value;
        }
        return value.endsWith("/") ? value.substring(0, value.length() - 1) : value;
    }

    private static String normalizeRelativePath(String path) {
        if (path == null || path.isBlank()) {
            return "";
        }
        return path.startsWith("/") ? path : "/" + path;
    }

    private static String normalizeRequestPath(String requestPath) {
        if (requestPath == null || requestPath.isBlank()) {
            return "";
        }
        return requestPath.startsWith("/") ? requestPath : "/" + requestPath;
    }
}
