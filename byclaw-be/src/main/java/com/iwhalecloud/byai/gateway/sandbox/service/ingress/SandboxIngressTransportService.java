package com.iwhalecloud.byai.gateway.sandbox.service.ingress;

import java.io.IOException;
import java.io.InputStream;
import java.io.PushbackInputStream;
import java.time.Duration;
import java.util.Enumeration;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.zip.GZIPInputStream;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
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

@Service
public class SandboxIngressTransportService {

    private static final Logger log = LoggerFactory.getLogger(SandboxIngressTransportService.class);

    private static final Set<String> HOP_BY_HOP_HEADERS = Set.of(
        "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
        "te", "trailer", "transfer-encoding", "upgrade");

    private final OkHttpClient httpClient;
    private final SandboxIngressRuntimeResolver runtimeResolver;

    @Autowired
    public SandboxIngressTransportService(SandboxIngressRuntimeResolver runtimeResolver) {
        this(runtimeResolver, new OkHttpClient.Builder()
            .connectTimeout(Duration.ofSeconds(30))
            .readTimeout(Duration.ofSeconds(120))
            .writeTimeout(Duration.ofSeconds(120))
            .callTimeout(Duration.ofSeconds(120))
            .build());
    }

    SandboxIngressTransportService(SandboxIngressRuntimeResolver runtimeResolver, OkHttpClient httpClient) {
        this.runtimeResolver = runtimeResolver;
        this.httpClient = httpClient;
    }

    public void forward(HttpServletRequest request,
                        HttpServletResponse response,
                        SandboxIngressRequestContext requestContext) {
        Request proxyRequest = buildProxyRequest(request, requestContext);
        log.debug("Forwarding ingress request upstream: method={}, instance={}, userCode={}, targetUrl={}",
            request.getMethod(), requestContext.instance(), requestContext.userCode(), requestContext.targetUrl());
        try (Response proxyResponse = httpClient.newCall(proxyRequest).execute()) {
            response.setStatus(proxyResponse.code());
            copyResponseHeaders(proxyResponse, response);
            log.debug("Received ingress upstream response: instance={}, userCode={}, targetUrl={}, status={}, contentType={}, contentEncoding={}",
                requestContext.instance(), requestContext.userCode(), requestContext.targetUrl(), proxyResponse.code(),
                proxyResponse.header(HttpHeaders.CONTENT_TYPE), proxyResponse.header(HttpHeaders.CONTENT_ENCODING));
            if (proxyResponse.body() == null) {
                return;
            }
            String contentEncoding = proxyResponse.header(HttpHeaders.CONTENT_ENCODING);
            try (InputStream body = openBodyStream(proxyResponse.body().byteStream(), contentEncoding)) {
                StreamUtils.copy(body, response.getOutputStream());
            }
        }
        catch (IOException e) {
            log.debug("Ingress upstream forwarding failed: instance={}, userCode={}, targetUrl={}",
                requestContext.instance(), requestContext.userCode(), requestContext.targetUrl(), e);
            throw new IllegalStateException("Failed to forward sandbox ingress request to " + requestContext.targetUrl(), e);
        }
    }

    private Request buildProxyRequest(HttpServletRequest request, SandboxIngressRequestContext requestContext) {
        RequestBody requestBody = buildRequestBody(request);
        Headers headers = buildProxyHeaders(request, requestContext);
        Request.Builder builder = new Request.Builder()
            .url(requestContext.targetUrl())
            .headers(headers)
            .method(request.getMethod(), requiresRequestBody(request.getMethod()) ? requestBody : null);
        runtimeResolver.resolve().customizeRequest(builder, requestContext);
        return builder.build();
    }

    private RequestBody buildRequestBody(HttpServletRequest request) {
        if (!requiresRequestBody(request.getMethod())) {
            return null;
        }
        String contentType = request.getContentType();
        MediaType mediaType = StringUtils.hasText(contentType) ? MediaType.parse(contentType) : null;
        long contentLength = request.getContentLengthLong();
        return new RequestBody() {
            @Override
            public MediaType contentType() {
                return mediaType;
            }

            @Override
            public long contentLength() {
                return contentLength;
            }

            @Override
            public void writeTo(BufferedSink sink) throws IOException {
                try (InputStream inputStream = request.getInputStream()) {
                    StreamUtils.copy(inputStream, sink.outputStream());
                }
            }
        };
    }

    private Headers buildProxyHeaders(HttpServletRequest request, SandboxIngressRequestContext requestContext) {
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

        if (requestContext.extraHeaders() != null) {
            for (Map.Entry<String, String> entry : requestContext.extraHeaders().entrySet()) {
                if (StringUtils.hasText(entry.getKey()) && StringUtils.hasText(entry.getValue())) {
                    builder.set(entry.getKey(), entry.getValue());
                }
            }
        }
        injectFilebrowserXAuthHeader(request, requestContext, builder);

        String forwardedFor = appendForwardedFor(request);
        if (StringUtils.hasText(forwardedFor)) {
            builder.set("X-Forwarded-For", forwardedFor);
        }
        builder.set("Accept-Encoding", "identity");
        builder.set("X-Forwarded-Proto", request.getScheme());
        builder.set("X-Forwarded-Host", request.getServerName());
        return builder.build();
    }

    private boolean shouldSkipRequestHeader(String headerName) {
        String normalized = headerName.toLowerCase();
        return HOP_BY_HOP_HEADERS.contains(normalized)
            || HttpHeaders.ACCEPT_ENCODING.equalsIgnoreCase(headerName)
            || HttpHeaders.HOST.equalsIgnoreCase(headerName)
            || HttpHeaders.CONTENT_LENGTH.equalsIgnoreCase(headerName);
    }

    private void injectFilebrowserXAuthHeader(HttpServletRequest request,
                                              SandboxIngressRequestContext requestContext,
                                              Headers.Builder builder) {
        if (!SandboxIngressInstanceType.FILEBROWSER.equals(requestContext.instanceType())) {
            return;
        }
        if (StringUtils.hasText(request.getHeader("X-Auth"))) {
            return;
        }
        String authToken = resolveCookieValue(request, "auth");
        if (!StringUtils.hasText(authToken)) {
            return;
        }
        builder.set("X-Auth", authToken);
        log.debug("Injected filebrowser X-Auth header from auth cookie: instance={}, userCode={}, targetUrl={}, token={}",
            requestContext.instance(), requestContext.userCode(), requestContext.targetUrl(), maskToken(authToken));
    }

    private String resolveCookieValue(HttpServletRequest request, String cookieName) {
        Cookie[] cookies = request.getCookies();
        if (cookies != null) {
            for (Cookie cookie : cookies) {
                if (cookieName.equals(cookie.getName()) && StringUtils.hasText(cookie.getValue())) {
                    return cookie.getValue().trim();
                }
            }
        }
        String cookieHeader = request.getHeader(HttpHeaders.COOKIE);
        if (!StringUtils.hasText(cookieHeader)) {
            return null;
        }
        String[] parts = cookieHeader.split(";");
        for (String part : parts) {
            String[] pair = part.trim().split("=", 2);
            if (pair.length == 2 && cookieName.equals(pair[0]) && StringUtils.hasText(pair[1])) {
                return pair[1].trim();
            }
        }
        return null;
    }

    private void copyResponseHeaders(Response proxyResponse, HttpServletResponse response) {
        Set<String> headerNames = new LinkedHashSet<>(proxyResponse.headers().names());
        for (String headerName : headerNames) {
            if (shouldSkipResponseHeader(headerName)) {
                continue;
            }
            for (String value : proxyResponse.headers(headerName)) {
                response.addHeader(headerName, value);
            }
        }
    }

    private boolean shouldSkipResponseHeader(String headerName) {
        String normalized = headerName.toLowerCase();
        return HOP_BY_HOP_HEADERS.contains(normalized)
            || HttpHeaders.CONTENT_ENCODING.equalsIgnoreCase(headerName)
            || HttpHeaders.CONTENT_LENGTH.equalsIgnoreCase(headerName);
    }

    private InputStream openBodyStream(InputStream source, String contentEncoding) throws IOException {
        if (!"gzip".equalsIgnoreCase(contentEncoding)) {
            return source;
        }
        PushbackInputStream pushbackInputStream = new PushbackInputStream(source, 2);
        byte[] signature = pushbackInputStream.readNBytes(2);
        if (signature.length < 2) {
            pushbackInputStream.unread(signature);
            return pushbackInputStream;
        }
        pushbackInputStream.unread(signature);
        boolean looksLikeGzip = (signature[0] & 0xff) == 0x1f && (signature[1] & 0xff) == 0x8b;
        if (!looksLikeGzip) {
            return pushbackInputStream;
        }
        return new GZIPInputStream(pushbackInputStream);
    }

    private String appendForwardedFor(HttpServletRequest request) {
        String existing = request.getHeader("X-Forwarded-For");
        String remoteAddr = request.getRemoteAddr();
        if (!StringUtils.hasText(existing)) {
            return remoteAddr;
        }
        if (!StringUtils.hasText(remoteAddr)) {
            return existing;
        }
        return existing + ", " + remoteAddr;
    }

    private boolean requiresRequestBody(String method) {
        return !("GET".equalsIgnoreCase(method) || "HEAD".equalsIgnoreCase(method));
    }

    private String maskToken(String token) {
        if (!StringUtils.hasText(token)) {
            return "<empty>";
        }
        String normalized = token.trim();
        if (normalized.length() <= 8) {
            return normalized;
        }
        return normalized.substring(0, 4) + "..." + normalized.substring(normalized.length() - 4);
    }
}
