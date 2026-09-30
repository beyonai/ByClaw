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
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/** Bounded, anonymous public-HTML fetch. Never forwards the caller's cookies or authorization. */
@Component
public class LinkPreviewFetcher {
    private static final int MAX_BYTES = 1024 * 1024;
    private static final int DIAGNOSTIC_PREFIX_BYTES = 64 * 1024;
    private static final Logger log = LoggerFactory.getLogger(LinkPreviewFetcher.class);
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
        long startedAt = System.nanoTime();
        String host = "unknown";
        int redirects = 0;
        int status = -1;
        try {
            HttpUrl url = PublicUrlPolicy.parse(input);
            host = url.host();
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(8);
            for (int hop = 0; hop <= 3; hop++) {
                long remaining = deadline - System.nanoTime();
                if (remaining <= 0) {
                    unavailable(host, "overall_timeout", status, redirects, startedAt);
                    return LinkPreviewResponse.unavailable();
                }
                var call = client.newCall(new Request.Builder().url(url)
                    .header("Accept", "text/html,application/xhtml+xml")
                    .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                        + "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36").build());
                call.timeout().timeout(Math.min(remaining, TimeUnit.SECONDS.toNanos(5)), TimeUnit.NANOSECONDS);
                try (Response response = call.execute()) {
                    status = response.code();
                    if (response.isRedirect()) {
                        String location = response.header("Location");
                        HttpUrl next = location == null ? null : url.resolve(location);
                        if (next == null) {
                            unavailable(host, "redirect_without_valid_location", status, redirects, startedAt);
                            return LinkPreviewResponse.unavailable();
                        }
                        redirects++;
                        url = PublicUrlPolicy.parse(next.toString());
                        continue;
                    }
                    ResponseBody body = response.body();
                    if (!response.isSuccessful()) {
                        unavailable(host, "http_status", status, redirects, startedAt);
                        return LinkPreviewResponse.unavailable();
                    }
                    if (body == null || body.contentType() == null) {
                        unavailable(host, "missing_body_or_content_type", status, redirects, startedAt);
                        return LinkPreviewResponse.unavailable();
                    }
                    String type = body.contentType().toString().split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
                    if (!(type.equals("text/html") || type.equals("application/xhtml+xml"))) {
                        unavailable(host, "unsupported_content_type", status, redirects, startedAt);
                        return LinkPreviewResponse.unavailable();
                    }
                    Charset charset = body.contentType().charset();
                    byte[] prefix = body.byteStream().readNBytes(DIAGNOSTIC_PREFIX_BYTES);
                    Document prefixDoc = Jsoup.parse(new ByteArrayInputStream(prefix),
                        charset == null ? null : charset.name(), url.toString());
                    LinkPreviewResponse prefixResult = metadata(prefixDoc, url);
                    if (prefixResult.resolved()) {
                        completed(host, status, redirects, prefix.length, startedAt);
                        return prefixResult;
                    }
                    if (body.contentLength() > MAX_BYTES) {
                        logOversizedBody(host, status, redirects, url, type, body.contentLength(), prefix, startedAt);
                        unavailable(host, "body_too_large", status, redirects, startedAt);
                        return LinkPreviewResponse.unavailable();
                    }
                    byte[] remainder = body.byteStream().readNBytes(MAX_BYTES - prefix.length + 1);
                    if (prefix.length + remainder.length > MAX_BYTES) {
                        logOversizedBody(host, status, redirects, url, type, body.contentLength(), prefix, startedAt);
                        unavailable(host, "body_too_large", status, redirects, startedAt);
                        return LinkPreviewResponse.unavailable();
                    }
                    byte[] bytes = java.util.Arrays.copyOf(prefix, prefix.length + remainder.length);
                    System.arraycopy(remainder, 0, bytes, prefix.length, remainder.length);
                    Document doc = Jsoup.parse(new ByteArrayInputStream(bytes),
                        charset == null ? null : charset.name(), url.toString());
                    LinkPreviewResponse result = metadata(doc, url);
                    if (result.resolved()) {
                        completed(host, status, redirects, bytes.length, startedAt);
                    } else {
                        log.warn("Link preview fetch unavailable: host={}, reason=no_preview_metadata, httpStatus={}, "
                                + "redirects={}, finalHost={}, contentType={}, bodyBytes={}, pageTitlePresent={}, "
                                + "ogTitlePresent={}, descriptionPresent={}, ogImagePresent={}, wechatArticleBodyPresent={}, "
                                + "scriptCount={}, elapsedMs={}",
                            host, status, redirects, url.host(), type, bytes.length, !doc.title().isBlank(),
                            !meta(doc, "og:title").isBlank(),
                            !meta(doc, "og:description").isBlank() || !meta(doc, "description").isBlank(),
                            !meta(doc, "og:image").isBlank(), doc.selectFirst("#js_content") != null,
                            doc.select("script").size(), elapsedMs(startedAt));
                    }
                    return result;
                }
            }
            unavailable(host, "too_many_redirects", status, redirects, startedAt);
        } catch (IOException failure) {
            // Log the exception type only: exception messages can contain full URLs or query strings.
            unavailable(host, "io_error_" + failure.getClass().getSimpleName(), status, redirects, startedAt);
        } catch (IllegalArgumentException ignored) {
            // Do not log the input, query string, exception message, or remote HTML.
            unavailable(host, "url_rejected", status, redirects, startedAt);
        }
        return LinkPreviewResponse.unavailable();
    }

    private void unavailable(String host, String reason, int status, int redirects, long startedAt) {
        log.warn("Link preview fetch unavailable: host={}, reason={}, httpStatus={}, redirects={}, elapsedMs={}",
            host, reason, status, redirects, elapsedMs(startedAt));
    }

    private void completed(String host, int status, int redirects, int bytesRead, long startedAt) {
        log.info("Link preview fetch completed: host={}, resolved=true, httpStatus={}, redirects={}, bytesRead={}, elapsedMs={}",
            host, status, redirects, bytesRead, elapsedMs(startedAt));
    }

    private long elapsedMs(long startedAt) {
        return TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedAt);
    }

    private void logOversizedBody(String host, int status, int redirects, HttpUrl url, String contentType,
                                  long declaredBytes, byte[] prefix, long startedAt) throws IOException {
        Document doc = Jsoup.parse(new ByteArrayInputStream(prefix), null, url.toString());
        log.warn("Link preview oversized response: host={}, httpStatus={}, redirects={}, finalHost={}, "
                + "contentType={}, declaredBytes={}, inspectedPrefixBytes={}, pageTitlePresent={}, ogTitlePresent={}, "
                + "descriptionPresent={}, ogImagePresent={}, wechatArticleBodyPresent={}, scriptCount={}, elapsedMs={}",
            host, status, redirects, url.host(), contentType, declaredBytes, prefix.length, !doc.title().isBlank(),
            !meta(doc, "og:title").isBlank(),
            !meta(doc, "og:description").isBlank() || !meta(doc, "description").isBlank(),
            !meta(doc, "og:image").isBlank(), doc.selectFirst("#js_content") != null,
            doc.select("script").size(), elapsedMs(startedAt));
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
