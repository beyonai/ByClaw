package com.iwhalecloud.byai.manager.domain.connector.provider.deepseek;

import java.util.List;

public record DeepSeekWebSearchResult(List<Source> sources, boolean truncated) {
    public DeepSeekWebSearchResult {
        sources = sources == null ? List.of() : List.copyOf(sources);
    }

    public record Source(String url, String title, String snippet, String publishedAt) {
    }
}
