package com.iwhalecloud.byai.manager.domain.connector.provider.deepseek;

import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.RejectedExecutionException;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;

@Component
public class DeepSeekWebSearchBatchExecutor {
    private final DeepSeekWebSearchClient client;
    private final ExecutorService executor;

    public DeepSeekWebSearchBatchExecutor(
            DeepSeekWebSearchClient client,
            @Qualifier("deepSeekWebSearchExecutor") ExecutorService executor) {
        this.client = client;
        this.executor = executor;
    }

    public DeepSeekWebSearchResult search(
            ConnectorInfo connector,
            String apiKey,
            List<String> queries,
            int maxResults) {
        List<CompletableFuture<DeepSeekWebSearchResult>> futures = new ArrayList<>();
        try {
            for (String query : queries) {
                futures.add(CompletableFuture.supplyAsync(
                    () -> client.search(connector, apiKey, query, maxResults), executor));
            }
        } catch (RejectedExecutionException e) {
            futures.forEach(future -> future.cancel(true));
            throw new DeepSeekWebSearchException(
                "DEEPSEEK_WEB_SEARCH_BUSY", "search concurrency limit reached", e);
        }
        List<DeepSeekWebSearchResult> results = new ArrayList<>();
        try {
            for (CompletableFuture<DeepSeekWebSearchResult> future : futures) {
                results.add(future.join());
            }
        } catch (CompletionException e) {
            futures.forEach(future -> future.cancel(true));
            Throwable cause = e.getCause();
            if (cause instanceof DeepSeekWebSearchException searchException) {
                throw searchException;
            }
            throw new DeepSeekWebSearchException(
                "DEEPSEEK_WEB_SEARCH_UNAVAILABLE", "batch search failed", cause);
        }
        return merge(results, maxResults);
    }

    private DeepSeekWebSearchResult merge(List<DeepSeekWebSearchResult> results, int maxResults) {
        List<DeepSeekWebSearchResult.Source> sources = new ArrayList<>();
        Set<String> seenUrls = new HashSet<>();
        int greatestResultSize = results.stream()
            .mapToInt(result -> result.sources().size())
            .max()
            .orElse(0);
        boolean dropped = false;
        outer:
        for (int rank = 0; rank < greatestResultSize; rank++) {
            for (DeepSeekWebSearchResult result : results) {
                if (rank >= result.sources().size()) {
                    continue;
                }
                DeepSeekWebSearchResult.Source source = result.sources().get(rank);
                if (!seenUrls.add(source.url())) {
                    continue;
                }
                if (sources.size() == maxResults) {
                    dropped = true;
                    break outer;
                }
                sources.add(source);
            }
        }
        return new DeepSeekWebSearchResult(
            sources, dropped || results.stream().anyMatch(DeepSeekWebSearchResult::truncated));
    }
}
