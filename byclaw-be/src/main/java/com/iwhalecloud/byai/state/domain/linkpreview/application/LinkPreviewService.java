package com.iwhalecloud.byai.state.domain.linkpreview.application;

import com.google.common.cache.Cache;
import com.google.common.cache.CacheBuilder;
import com.iwhalecloud.byai.state.domain.linkpreview.dto.LinkPreviewResponse;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import org.springframework.stereotype.Service;

@Service
public class LinkPreviewService {
    private final LinkPreviewFetcher fetcher;
    private final Semaphore slots = new Semaphore(8);
    // Public, anonymous metadata only. Cache#get also coalesces requests for the same URL.
    private final Cache<String, LinkPreviewResponse> cache = CacheBuilder.newBuilder()
        .maximumSize(512).expireAfterWrite(5, TimeUnit.MINUTES).build();

    public LinkPreviewService(LinkPreviewFetcher fetcher) {
        this.fetcher = fetcher;
    }

    public LinkPreviewResponse preview(String rawUrl) {
        try {
            String url = PublicUrlPolicy.parse(rawUrl).toString();
            return cache.get(url, () -> {
                if (!slots.tryAcquire()) throw new PreviewBusyException();
                try {
                    return fetcher.fetch(url);
                } finally {
                    slots.release();
                }
            });
        } catch (IllegalArgumentException | ExecutionException ignored) {
            return LinkPreviewResponse.unavailable();
        }
    }

    private static final class PreviewBusyException extends Exception {}
}
