package com.iwhalecloud.byai.state.application.service.recorder;

import com.iwhalecloud.byai.state.domain.recorder.model.RecorderSession;
import java.net.URI;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class RecorderRankService {

    public List<Map<String, Object>> rank(RecorderSession session) {
        List<Map<String, Object>> entries = new ArrayList<>();
        session.samples().values().forEach(entries::addAll);
        if (entries.isEmpty()) {
            return List.of();
        }
        Map<String, Object> first = entries.getFirst();
        String url = String.valueOf(first.getOrDefault("url", "https://example.com/search"));
        URI uri = URI.create(url);
        String host = uri.getHost() == null ? "example.com" : uri.getHost();
        String path = uri.getPath() == null || uri.getPath().isBlank() ? "/" : uri.getPath();
        Map<String, String> query = queryParams(uri.getRawQuery());
        String id = "cand_" + sanitize(host + path.replace('/', '_'));

        Map<String, Object> endpoint = new LinkedHashMap<>();
        endpoint.put("method", String.valueOf(first.getOrDefault("method", "GET")));
        endpoint.put("urlTemplate", templateUrl(uri, query));
        endpoint.put("host", host);
        endpoint.put("pathname", path);
        endpoint.put("queryParams", queryTemplate(query));
        endpoint.put("authRequired", false);

        List<Map<String, Object>> args = query.keySet().stream()
            .map(name -> Map.<String, Object>of(
                "argName", name,
                "in", "query",
                "paramName", name,
                "valueType", "string"
            ))
            .toList();

        Map<String, Object> candidate = new LinkedHashMap<>();
        candidate.put("id", id);
        candidate.put("endpoint", endpoint);
        candidate.put("score", query.isEmpty() ? 72 : 88);
        candidate.put("confidence", query.isEmpty() ? "medium" : "high");
        candidate.put("reviewRequired", false);
        candidate.put("args", args);
        candidate.put("columns", List.of(Map.of("name", "title", "path", "$.items[].title", "type", "string")));
        candidate.put("scoreExplanation", List.of(Map.of(
            "signal", "captured endpoint appears in A/B samples",
            "delta", query.isEmpty() ? 20 : 36
        )));
        candidate.put("risks", List.of("Java recorder ranker uses deterministic capture heuristics; semantic LLM scoring is delegated to pipeline."));
        candidate.put("mergedRequestIds", entries.stream().map(e -> e.get("requestId")).filter(String.class::isInstance).toList());
        return List.of(candidate);
    }

    private Map<String, String> queryParams(String rawQuery) {
        if (rawQuery == null || rawQuery.isBlank()) {
            return Map.of();
        }
        Map<String, String> result = new LinkedHashMap<>();
        for (String part : rawQuery.split("&")) {
            if (part.isBlank()) {
                continue;
            }
            int idx = part.indexOf('=');
            String name = idx >= 0 ? part.substring(0, idx) : part;
            String value = idx >= 0 ? part.substring(idx + 1) : "";
            result.put(name, value);
        }
        return result;
    }

    private Map<String, Object> queryTemplate(Map<String, String> query) {
        Map<String, Object> result = new LinkedHashMap<>();
        query.forEach((name, ignored) -> result.put(name, "{" + name + "}"));
        return result;
    }

    private String templateUrl(URI uri, Map<String, String> query) {
        StringBuilder builder = new StringBuilder();
        builder.append(uri.getScheme() == null ? "https" : uri.getScheme()).append("://");
        builder.append(uri.getHost() == null ? "example.com" : uri.getHost());
        builder.append(uri.getPath() == null || uri.getPath().isBlank() ? "/" : uri.getPath());
        if (!query.isEmpty()) {
            builder.append("?");
            boolean first = true;
            for (String name : query.keySet()) {
                if (!first) {
                    builder.append("&");
                }
                builder.append(name).append("={").append(name).append("}");
                first = false;
            }
        }
        return builder.toString();
    }

    private String sanitize(String value) {
        return value.replaceAll("[^A-Za-z0-9]+", "_").replaceAll("^_+|_+$", "").toLowerCase();
    }
}
