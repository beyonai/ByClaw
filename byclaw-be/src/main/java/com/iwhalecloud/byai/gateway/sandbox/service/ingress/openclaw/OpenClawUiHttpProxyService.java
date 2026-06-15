package com.iwhalecloud.byai.gateway.sandbox.service.ingress.openclaw;

import java.io.IOException;
import java.io.InputStream;
import java.time.Duration;
import java.util.Enumeration;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Service;
import org.springframework.util.StreamUtils;
import org.springframework.util.StringUtils;

import okhttp3.Headers;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okio.BufferedSink;

/**
 * OpenClaw 控制台整页代理的 HTTP 转发核心。
 *
 * <p>与 {@code SandboxIngressTransportService} 类似的一次性 HTTP 转发，但目标地址由调用方
 * 直接给出（来自 URL 路径里的 ip:port），不依赖沙箱注册表。响应体默认原样流式透传，
 * 同时支持调用方在转发前对响应做文本改写（如改写 control-ui-config.json 的 basePath）。
 */
@Service
public class OpenClawUiHttpProxyService {

    private static final Logger log = LoggerFactory.getLogger(OpenClawUiHttpProxyService.class);

    private static final Set<String> HOP_BY_HOP_HEADERS = Set.of(
        "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
        "te", "trailer", "transfer-encoding", "upgrade");
    private static final Set<String> REQUEST_BODY_REQUIRED_METHODS = Set.of(
        "POST", "PUT", "PATCH", "PROPPATCH", "REPORT");

    private final OkHttpClient httpClient = new OkHttpClient.Builder()
        .connectTimeout(Duration.ofSeconds(30))
        .readTimeout(Duration.ofSeconds(120))
        .writeTimeout(Duration.ofSeconds(120))
        .callTimeout(Duration.ofSeconds(120))
        .followRedirects(false)
        .build();

    /**
     * 把请求转发到 targetUrl。若 bodyRewriter 非空，则缓冲响应体、交给它改写后再写出；
     * 否则原样流式透传。
     */
    public void forward(HttpServletRequest request,
                        HttpServletResponse response,
                        String targetUrl,
                        ResponseBodyRewriter bodyRewriter) {
        Request proxyRequest = buildProxyRequest(request, targetUrl);
        log.debug("OpenClaw ui proxy forward: method={}, target={}", request.getMethod(), maskToken(targetUrl));
        try (Response proxyResponse = httpClient.newCall(proxyRequest).execute()) {
            response.setStatus(proxyResponse.code());
            copyResponseHeaders(proxyResponse, response, bodyRewriter != null);
            if (proxyResponse.body() == null) {
                return;
            }
            if (bodyRewriter != null) {
                byte[] original = proxyResponse.body().bytes();
                byte[] rewritten = bodyRewriter.rewrite(original);
                response.setContentLength(rewritten.length);
                response.getOutputStream().write(rewritten);
                return;
            }
            try (InputStream body = proxyResponse.body().byteStream()) {
                StreamUtils.copy(body, response.getOutputStream());
            }
        }
        catch (IOException e) {
            log.debug("OpenClaw ui proxy forward failed: target={}", maskToken(targetUrl), e);
            throw new IllegalStateException("Failed to forward openclaw ui request to " + maskToken(targetUrl), e);
        }
    }

    private Request buildProxyRequest(HttpServletRequest request, String targetUrl) {
        RequestBody requestBody = buildRequestBody(request);
        Headers headers = buildProxyHeaders(request, targetUrl);
        return new Request.Builder()
            .url(targetUrl)
            .headers(headers)
            .method(request.getMethod(), requestBody)
            .build();
    }

    private RequestBody buildRequestBody(HttpServletRequest request) {
        String method = request.getMethod();
        if ("GET".equalsIgnoreCase(method) || "HEAD".equalsIgnoreCase(method)) {
            return null;
        }
        String contentType = request.getContentType();
        MediaType mediaType = StringUtils.hasText(contentType) ? MediaType.parse(contentType) : null;
        boolean hasBody = hasRequestBody(request);
        boolean requiresBody = REQUEST_BODY_REQUIRED_METHODS.contains(method.toUpperCase(Locale.ROOT));
        if (!requiresBody && !hasBody) {
            return null;
        }
        if (!hasBody) {
            return RequestBody.create(new byte[0], mediaType);
        }
        return new RequestBody() {
            @Override
            public MediaType contentType() {
                return mediaType;
            }

            @Override
            public long contentLength() {
                return -1;
            }

            @Override
            public void writeTo(BufferedSink sink) throws IOException {
                try (InputStream inputStream = request.getInputStream()) {
                    StreamUtils.copy(inputStream, sink.outputStream());
                }
            }

            @Override
            public boolean isOneShot() {
                return true;
            }
        };
    }

    private Headers buildProxyHeaders(HttpServletRequest request, String targetUrl) {
        Headers.Builder builder = new Headers.Builder();
        Enumeration<String> headerNames = request.getHeaderNames();
        while (headerNames.hasMoreElements()) {
            String headerName = headerNames.nextElement();
            if (shouldSkipRequestHeader(headerName)) {
                continue;
            }
            Enumeration<String> values = request.getHeaders(headerName);
            while (values.hasMoreElements()) {
                builder.add(headerName, values.nextElement());
            }
        }
        // 要求上游不要压缩，便于按需改写响应体。
        builder.set("Accept-Encoding", "identity");
        builder.set("X-Forwarded-Proto", request.getScheme());
        builder.set("X-Forwarded-Host", request.getServerName());
        String remoteAddr = request.getRemoteAddr();
        if (StringUtils.hasText(remoteAddr)) {
            builder.set("X-Forwarded-For", remoteAddr);
        }
        // openclaw 校验 Origin/Referer，整页代理下浏览器带的是网关地址，改写成上游地址使其同源放行。
        String upstreamOrigin = originOf(targetUrl);
        if (upstreamOrigin != null) {
            builder.set("Origin", upstreamOrigin);
            builder.set("Referer", upstreamOrigin + "/");
        }
        return builder.build();
    }

    /** 从目标 URL 提取 scheme://host:port 作为 Origin。 */
    private static String originOf(String targetUrl) {
        try {
            java.net.URI uri = java.net.URI.create(targetUrl);
            String scheme = uri.getScheme();
            String host = uri.getHost();
            int port = uri.getPort();
            if (scheme == null || host == null) {
                return null;
            }
            return port >= 0 ? scheme + "://" + host + ":" + port : scheme + "://" + host;
        }
        catch (Exception e) {
            return null;
        }
    }

    private boolean shouldSkipRequestHeader(String headerName) {
        String normalized = headerName.toLowerCase(Locale.ROOT);
        return HOP_BY_HOP_HEADERS.contains(normalized)
            || HttpHeaders.ACCEPT_ENCODING.equalsIgnoreCase(headerName)
            || HttpHeaders.HOST.equalsIgnoreCase(headerName)
            || HttpHeaders.CONTENT_LENGTH.equalsIgnoreCase(headerName);
    }

    private void copyResponseHeaders(Response proxyResponse, HttpServletResponse response, boolean rewriting) {
        Set<String> headerNames = new LinkedHashSet<>(proxyResponse.headers().names());
        for (String headerName : headerNames) {
            if (shouldSkipResponseHeader(headerName, rewriting)) {
                continue;
            }
            for (String value : proxyResponse.headers(headerName)) {
                response.addHeader(headerName, value);
            }
        }
    }

    private boolean shouldSkipResponseHeader(String headerName, boolean rewriting) {
        String normalized = headerName.toLowerCase(Locale.ROOT);
        if (HOP_BY_HOP_HEADERS.contains(normalized) || HttpHeaders.CONTENT_ENCODING.equalsIgnoreCase(headerName)) {
            return true;
        }
        // 改写响应体时，原 Content-Length 会失效，由调用方重设。
        return rewriting && HttpHeaders.CONTENT_LENGTH.equalsIgnoreCase(headerName);
    }

    private boolean hasRequestBody(HttpServletRequest request) {
        if (request.getContentLengthLong() > 0) {
            return true;
        }
        String transferEncoding = request.getHeader(HttpHeaders.TRANSFER_ENCODING);
        return StringUtils.hasText(transferEncoding)
            && transferEncoding.toLowerCase(Locale.ROOT).contains("chunked");
    }

    private static String maskToken(String url) {
        return url == null ? null : url.replaceAll("token=[^&]+", "token=***");
    }

    /** 响应体改写回调。 */
    @FunctionalInterface
    public interface ResponseBodyRewriter {
        byte[] rewrite(byte[] original);
    }
}
