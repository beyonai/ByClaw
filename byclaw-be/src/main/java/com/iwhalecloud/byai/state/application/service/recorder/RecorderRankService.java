package com.iwhalecloud.byai.state.application.service.recorder;

import com.iwhalecloud.byai.state.domain.recorder.model.RecorderSession;
import java.net.URI;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Component;

@Component
public class RecorderRankService {

    public List<Map<String, Object>> rank(RecorderSession session) {
        Map<String, Aggregate> aggregates = new LinkedHashMap<>();
        session.samples().forEach((sampleName, entries) -> entries.forEach(entry -> addEntry(aggregates, sampleName, entry)));
        return aggregates.values().stream()
            .sorted(Comparator.comparingInt(Aggregate::score).reversed().thenComparing(Aggregate::key))
            .map(this::candidate)
            .toList();
    }

    private void addEntry(Map<String, Aggregate> aggregates, String sampleName, Map<String, Object> entry) {
        String rawUrl = entry.get("url") instanceof String url ? url : "";
        URI uri;
        try {
            uri = URI.create(rawUrl);
        } catch (IllegalArgumentException ignored) {
            return;
        }
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if ((!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) || host == null || isNoise(uri)) {
            return;
        }
        String method = entry.get("method") instanceof String value && !value.isBlank() ? value.toUpperCase() : "GET";
        String path = uri.getPath() == null || uri.getPath().isBlank() ? "/" : uri.getPath();
        String key = method + " " + host + path;
        Aggregate aggregate = aggregates.computeIfAbsent(key, ignored -> new Aggregate(key, method, uri, path));
        aggregate.add(sampleName, entry, queryParams(uri.getRawQuery()));
    }

    private Map<String, Object> candidate(Aggregate aggregate) {
        URI uri = aggregate.uri();
        String host = uri.getHost();
        Map<String, String> query = aggregate.query();
        String id = "cand_" + sanitize(host + aggregate.path().replace('/', '_'));

        Map<String, Object> endpoint = new LinkedHashMap<>();
        endpoint.put("method", aggregate.method());
        endpoint.put("urlTemplate", templateUrl(uri, query));
        endpoint.put("host", host);
        endpoint.put("pathname", aggregate.path());
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
        candidate.put("score", aggregate.score());
        candidate.put("confidence", aggregate.score() >= 85 ? "high" : aggregate.score() >= 70 ? "medium" : "low");
        candidate.put("reviewRequired", aggregate.score() < 70);
        candidate.put("args", args);
        candidate.put("columns", List.of(Map.of("name", "title", "path", "$.items[].title", "type", "string")));
        candidate.put("scoreExplanation", scoreExplanation(aggregate));
        candidate.put("risks", List.of("Java recorder ranker uses deterministic capture heuristics; semantic LLM scoring is delegated to pipeline."));
        candidate.put("mergedRequestIds", aggregate.requestIds());
        return candidate;
    }

    private boolean isNoise(URI uri) {
        String host = uri.getHost().toLowerCase();
        String path = (uri.getPath() == null ? "" : uri.getPath()).toLowerCase();
        return host.contains("mon.")
            || host.contains("mcs.")
            || host.contains("mssdk")
            || host.contains("vcs.")
            || host.contains("bytereplay")
            || host.contains("bytetcc")
            || host.contains("abtest")
            || host.contains("snssdk")
            || path.contains("/monitor")
            || path.contains("/collect")
            || path.contains("/setting")
            || path.contains("/config");
    }

    private List<Map<String, Object>> scoreExplanation(Aggregate aggregate) {
        List<Map<String, Object>> explanation = new ArrayList<>();
        explanation.add(Map.of("signal", "captured endpoint appears in " + aggregate.samples().size() + " sample(s)", "delta", 10));
        if (aggregate.hasSearchParameter()) {
            explanation.add(Map.of("signal", "search-like query parameter detected", "delta", 25));
        }
        if (aggregate.hasVaryingSearchParameter()) {
            explanation.add(Map.of("signal", "search query changes between captured samples", "delta", 20));
        }
        return explanation;
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

    private static final class Aggregate {
        private static final Set<String> SEARCH_PARAMETERS = Set.of("query", "q", "keyword", "keywords", "search");

        private final String key;
        private final String method;
        private final URI uri;
        private final String path;
        private final Map<String, String> query = new LinkedHashMap<>();
        private final Map<String, Set<String>> queryValues = new LinkedHashMap<>();
        private final Set<String> samples = new LinkedHashSet<>();
        private final List<String> requestIds = new ArrayList<>();

        private Aggregate(String key, String method, URI uri, String path) {
            this.key = key;
            this.method = method;
            this.uri = uri;
            this.path = path;
        }

        private void add(String sampleName, Map<String, Object> entry, Map<String, String> entryQuery) {
            samples.add(sampleName);
            entryQuery.forEach((name, value) -> {
                query.putIfAbsent(name, value);
                queryValues.computeIfAbsent(name, ignored -> new LinkedHashSet<>()).add(value);
            });
            if (entry.get("requestId") instanceof String requestId && !requestId.isBlank()) {
                requestIds.add(requestId);
            }
        }

        private int score() {
            int score = 60 + Math.min(12, Math.max(0, requestIds.size() - 1) * 4);
            if (samples.size() > 1) score += 10;
            if (hasSearchParameter()) score += 25;
            if (hasVaryingSearchParameter()) score += 20;
            return Math.min(score, 99);
        }

        private boolean hasSearchParameter() {
            return query.keySet().stream().map(String::toLowerCase).anyMatch(SEARCH_PARAMETERS::contains);
        }

        private boolean hasVaryingSearchParameter() {
            return queryValues.entrySet().stream()
                .anyMatch(entry -> SEARCH_PARAMETERS.contains(entry.getKey().toLowerCase()) && entry.getValue().size() > 1);
        }

        private String key() { return key; }
        private String method() { return method; }
        private URI uri() { return uri; }
        private String path() { return path; }
        private Map<String, String> query() { return query; }
        private Set<String> samples() { return samples; }
        private List<String> requestIds() { return requestIds; }
    }
}
