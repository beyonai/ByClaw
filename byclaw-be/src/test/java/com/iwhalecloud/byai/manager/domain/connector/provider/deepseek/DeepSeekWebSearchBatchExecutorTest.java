package com.iwhalecloud.byai.manager.domain.connector.provider.deepseek;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class DeepSeekWebSearchBatchExecutorTest {

    @Test
    void runsWithinExecutorLimitAndMergesSourcesRoundRobin() {
        AtomicInteger active = new AtomicInteger();
        AtomicInteger peak = new AtomicInteger();
        DeepSeekWebSearchClient client = (connector, apiKey, query, maxResults) -> {
            int now = active.incrementAndGet();
            peak.accumulateAndGet(now, Math::max);
            try {
                Thread.sleep(40);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new RuntimeException(e);
            } finally {
                active.decrementAndGet();
            }
            return new DeepSeekWebSearchResult(List.of(
                source(query + "-1"), source("shared"), source(query + "-2")), false);
        };
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            DeepSeekWebSearchBatchExecutor batch = new DeepSeekWebSearchBatchExecutor(client, executor);

            DeepSeekWebSearchResult result = batch.search(
                new ConnectorInfo(), "secret", List.of("a", "b", "c"), 5);

            assertThat(peak.get()).isLessThanOrEqualTo(2);
            assertThat(result.sources()).extracting(DeepSeekWebSearchResult.Source::url)
                .containsExactly("a-1", "b-1", "c-1", "shared", "a-2");
            assertThat(result.truncated()).isTrue();
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    void rejectsBatchWhenTheBoundedExecutorIsSaturated() throws InterruptedException {
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        DeepSeekWebSearchClient client = (connector, apiKey, query, maxResults) -> {
            started.countDown();
            try {
                release.await();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            return new DeepSeekWebSearchResult(List.of(), false);
        };
        ExecutorService executor = new ThreadPoolExecutor(
            1, 1, 0L, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(1),
            new ThreadPoolExecutor.AbortPolicy());
        try {
            DeepSeekWebSearchBatchExecutor batch = new DeepSeekWebSearchBatchExecutor(client, executor);

            assertThatThrownBy(() -> batch.search(
                new ConnectorInfo(), "secret", List.of("a", "b", "c"), 5))
                .isInstanceOf(DeepSeekWebSearchException.class)
                .hasMessageContaining("DEEPSEEK_WEB_SEARCH_BUSY");
            assertThat(started.await(1, TimeUnit.SECONDS)).isTrue();
        } finally {
            release.countDown();
            executor.shutdownNow();
        }
    }

    private DeepSeekWebSearchResult.Source source(String url) {
        return new DeepSeekWebSearchResult.Source(url, url, null, null);
    }
}
