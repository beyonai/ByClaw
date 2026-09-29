package com.iwhalecloud.byai.state.domain.linkpreview.application;

import com.iwhalecloud.byai.state.domain.linkpreview.dto.LinkPreviewResponse;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.Proxy;
import java.nio.charset.Charset;
import java.util.Locale;
import java.util.concurrent.TimeUnit;
import okhttp3.Dns;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.springframework.stereotype.Component;

/** Bounded, anonymous public-HTML fetch. Never forwards the caller's cookies or authorization. */
@Component
public class LinkPreviewFetcher {
    private static final int MAX_BYTES = 1024 * 1024;
    private final OkHttpClient client;

    public LinkPreviewFetcher() {
        this(new OkHttpClient.Builder().dns(PublicUrlPolicy.guardedDns(Dns.SYSTEM))
            .proxy(Proxy.NO_PROXY).followRedirects(false).followSslRedirects(false)
            .retryOnConnectionFailure(false).connectTimeout(3, TimeUnit.SECONDS)
            .readTimeout(5, TimeUnit.SECONDS).callTimeout(5, TimeUnit.SECONDS).build());
    }

    LinkPreviewFetcher(OkHttpClient client) {
        this.client = client;
    }

    public LinkPreviewResponse fetch(String input) {
        try {
            HttpUrl url = PublicUrlPolicy.parse(input);
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(8);
            for (int hop = 0; hop <= 3; hop++) {
                long remaining = deadline - System.nanoTime();
                if (remaining <= 0) return LinkPreviewResponse.unavailable();
                var call = client.newCall(new Request.Builder().url(url)
                    .header("Accept", "text/html,application/xhtml+xml")
                    .header("User-Agent", "ByClaw-LinkPreview/1.0").build());
                call.timeout().timeout(Math.min(remaining, TimeUnit.SECONDS.toNanos(5)), TimeUnit.NANOSECONDS);
                try (Response response = call.execute()) {
                    if (response.isRedirect()) {
                        String location = response.header("Location");
                        HttpUrl next = location == null ? null : url.resolve(location);
                        if (next == null) return LinkPreviewResponse.unavailable();
                        url = PublicUrlPolicy.parse(next.toString());
                        continue;
                    }
                    ResponseBody body = response.body();
                    if (!response.isSuccessful() || body == null || body.contentType() == null) {
                        return LinkPreviewResponse.unavailable();
                    }
                    String type = body.contentType().toString().split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
                    if (!(type.equals("text/html") || type.equals("application/xhtml+xml"))
                        || body.contentLength() > MAX_BYTES) return LinkPreviewResponse.unavailable();
                    byte[] bytes = body.byteStream().readNBytes(MAX_BYTES + 1);
                    if (bytes.length > MAX_BYTES) return LinkPreviewResponse.unavailable();
                    Charset charset = body.contentType().charset();
                    Document doc = Jsoup.parse(new ByteArrayInputStream(bytes),
                        charset == null ? null : charset.name(), url.toString());
                    return metadata(doc, url);
                }
            }
        } catch (IOException | IllegalArgumentException ignored) {
            // Quiet degradation. Do not log URLs, query strings or remote HTML.
        }
        return LinkPreviewResponse.unavailable();
    }

    private LinkPreviewResponse metadata(Document doc, HttpUrl base) {
        String title = text(first(meta(doc, "og:title"), doc.title()), 300);
        String description = text(first(meta(doc, "og:description"), meta(doc, "description")), 600);
        String image = asset(meta(doc, "og:image"), base);
        Element icon = doc.head().selectFirst("link[rel~=(?i)^(shortcut\\s+)?icon$]");
        String favicon = asset(icon == null ? "/favicon.ico" : icon.attr("href"), base);
        String siteName = text(first(meta(doc, "og:site_name"), base.host()), 120);
        return new LinkPreviewResponse(!title.isEmpty() || !description.isEmpty() || !image.isEmpty(),
            title, description, favicon, image, siteName);
    }

    private String meta(Document doc, String name) {
        Element element = doc.head().selectFirst("meta[property=" + name + "],meta[name=" + name + "]");
        return element == null ? "" : element.attr("content").trim();
    }

    private String asset(String value, HttpUrl base) {
        if (value.isBlank()) return "";
        HttpUrl url = base.resolve(value);
        try {
            return url == null ? "" : PublicUrlPolicy.parse(url.toString()).toString();
        } catch (IllegalArgumentException ignored) {
            return "";
        }
    }

    private String first(String primary, String fallback) {
        return primary.isBlank() ? fallback : primary;
    }

    private String text(String value, int maxLength) {
        String clean = value.replaceAll("[\\p{Cntrl}\\s]+", " ").trim();
        return clean.substring(0, Math.min(maxLength, clean.length()));
    }
}
