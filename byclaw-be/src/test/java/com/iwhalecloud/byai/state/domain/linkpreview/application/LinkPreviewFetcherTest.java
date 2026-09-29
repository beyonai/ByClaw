package com.iwhalecloud.byai.state.domain.linkpreview.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.InetAddress;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.junit.jupiter.api.Test;

class LinkPreviewFetcherTest {
    @Test
    void parsesMetadataAndResolvesAssetsAgainstFinalUrl() {
        AtomicInteger calls = new AtomicInteger();
        OkHttpClient client = new OkHttpClient.Builder().addInterceptor(chain -> {
            calls.incrementAndGet();
            if (chain.request().url().encodedPath().equals("/start")) {
                return response(chain.request(), 302, "").newBuilder().header("Location", "/articles/page").build();
            }
            return response(chain.request(), 200, """
                <html><head><title>Fallback</title><meta property="og:title" content="Article">
                <meta name="description" content="Summary"><meta property="og:image" content="../cover.jpg">
                <link rel="icon" href="/icon.png"><meta property="og:site_name" content="Publisher">
                </head><body><script>ignored()</script></body></html>
                """);
        }).build();
        var result = new LinkPreviewFetcher(client).fetch("https://example.com/start");
        assertThat(result.resolved()).isTrue();
        assertThat(result.title()).isEqualTo("Article");
        assertThat(result.description()).isEqualTo("Summary");
        assertThat(result.ogImage()).isEqualTo("https://example.com/cover.jpg");
        assertThat(result.favicon()).isEqualTo("https://example.com/icon.png");
        assertThat(calls).hasValue(2);
    }

    @Test
    void refusesPrivateRedirectBeforeMakingAnotherRequest() {
        AtomicInteger calls = new AtomicInteger();
        OkHttpClient client = new OkHttpClient.Builder().addInterceptor(chain -> {
            calls.incrementAndGet();
            return response(chain.request(), 302, "").newBuilder()
                .header("Location", "http://127.0.0.1/admin").build();
        }).build();
        assertThat(new LinkPreviewFetcher(client).fetch("https://example.com").resolved()).isFalse();
        assertThat(calls).hasValue(1);
    }

    @Test
    void refusesOversizedAndNonHtmlBodies() {
        for (String type : List.of("text/html", "application/json")) {
            OkHttpClient client = new OkHttpClient.Builder().addInterceptor(chain ->
                response(chain.request(), 200, "x".repeat(1024 * 1024 + 1)).newBuilder()
                    .body(ResponseBody.create("x".repeat(1024 * 1024 + 1), MediaType.get(type))).build()).build();
            assertThat(new LinkPreviewFetcher(client).fetch("https://example.com").resolved()).isFalse();
        }
    }

    @Test
    void cachesSuccessfulAndUnavailableResults() {
        AtomicInteger calls = new AtomicInteger();
        OkHttpClient client = new OkHttpClient.Builder().addInterceptor(chain -> {
            calls.incrementAndGet();
            return response(chain.request(), chain.request().url().encodedPath().equals("/missing") ? 404 : 200,
                "<title>Cached</title>");
        }).build();
        var service = new LinkPreviewService(new LinkPreviewFetcher(client));
        assertThat(service.preview("https://example.com").title()).isEqualTo("Cached");
        assertThat(service.preview("https://example.com/#section").title()).isEqualTo("Cached");
        assertThat(calls).hasValue(1);
        assertThat(service.preview("https://example.com/missing").resolved()).isFalse();
        assertThat(service.preview("https://example.com/missing").resolved()).isFalse();
        assertThat(calls).hasValue(2);
    }

    @Test
    void limitsRedirectLoopsAndDoesNotForwardCredentials() {
        AtomicInteger calls = new AtomicInteger();
        OkHttpClient client = new OkHttpClient.Builder().addInterceptor(chain -> {
            calls.incrementAndGet();
            assertThat(chain.request().header("Authorization")).isNull();
            assertThat(chain.request().header("Cookie")).isNull();
            return response(chain.request(), 302, "").newBuilder().header("Location", "/again").build();
        }).build();
        assertThat(new LinkPreviewFetcher(client).fetch("https://example.com").resolved()).isFalse();
        assertThat(calls).hasValue(4);
    }

    @Test
    void dropsUnsafeImageUrlsAndTreatsHtmlTitleAsText() {
        OkHttpClient client = new OkHttpClient.Builder().addInterceptor(chain -> response(chain.request(), 200,
            "<title>&lt;script&gt;hello&lt;/script&gt;</title><meta property='og:image' content='javascript:alert(1)'>"
                + "<link rel='icon' href='http://127.0.0.1/icon'>")).build();
        var result = new LinkPreviewFetcher(client).fetch("https://example.com");
        assertThat(result.title()).isEqualTo("<script>hello</script>");
        assertThat(result.ogImage()).isEmpty();
        assertThat(result.favicon()).isEmpty();
    }

    @Test
    void rejectsNonPublicAddressesIncludingMixedDnsAnswers() throws Exception {
        for (String address : List.of("127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.0.1",
            "192.168.1.1", "172.16.0.1", "::1", "fc00::1", "fe80::1", "2002:7f00:1::")) {
            assertThat(PublicUrlPolicy.isPublic(InetAddress.getByName(address))).as(address).isFalse();
        }
        assertThat(PublicUrlPolicy.isPublic(InetAddress.getByName("93.184.216.34"))).isTrue();
        var dns = PublicUrlPolicy.guardedDns(host -> List.of(
            InetAddress.getByName("93.184.216.34"), InetAddress.getByName("127.0.0.1")));
        assertThatThrownBy(() -> dns.lookup("example.com")).isInstanceOf(java.net.UnknownHostException.class);
    }

    @Test
    void rejectsCredentialsInvalidPortsAndProtocols() {
        for (String url : List.of("file:///etc/passwd", "https://user:pass@example.com", "http://example.com:0", "http://example.com:65536",
            "http://127.0.0.1:18080", "http://[::1]:18080", "http://2130706433", "http://localhost")) {
            assertThatThrownBy(() -> PublicUrlPolicy.parse(url)).as(url).isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Test
    void fetchesCustomPortsAndPreservesPortsInRedirectsAndAssets() {
        OkHttpClient client = new OkHttpClient.Builder().addInterceptor(chain -> {
            if (chain.request().url().encodedPath().equals("/start")) {
                return response(chain.request(), 302, "").newBuilder()
                    .header("Location", "https://example.com:18443/article").build();
            }
            return response(chain.request(), 200,
                "<title>Custom port</title><meta property='og:image' content='/cover.png'>");
        }).build();
        var result = new LinkPreviewFetcher(client).fetch("http://example.com:18080/start");
        assertThat(result.resolved()).isTrue();
        assertThat(result.title()).isEqualTo("Custom port");
        assertThat(result.ogImage()).isEqualTo("https://example.com:18443/cover.png");
        assertThat(result.favicon()).isEqualTo("https://example.com:18443/favicon.ico");
        for (int port : List.of(1, 8080, 18080, 18443, 65535)) {
            assertThat(PublicUrlPolicy.parse("http://example.com:" + port).port()).isEqualTo(port);
        }
    }

    @Test
    void boundsSlowDnsResolution() {
        var dns = PublicUrlPolicy.guardedDns(host -> {
            try { Thread.sleep(10000); } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
            throw new java.net.UnknownHostException("fixture");
        });
        org.junit.jupiter.api.Assertions.assertTimeoutPreemptively(java.time.Duration.ofSeconds(4), () ->
            assertThatThrownBy(() -> dns.lookup("example.com")).isInstanceOf(java.net.UnknownHostException.class));
    }

    private Response response(okhttp3.Request request, int code, String html) {
        return new Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(code).message("fixture")
            .body(ResponseBody.create(html, MediaType.get("text/html; charset=utf-8"))).build();
    }
}
