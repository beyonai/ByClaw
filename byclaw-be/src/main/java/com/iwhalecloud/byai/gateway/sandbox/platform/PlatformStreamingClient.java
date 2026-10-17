package com.iwhalecloud.byai.gateway.sandbox.platform;

import feign.Client;
import feign.Request;
import feign.Response;
import java.io.*;
import java.nio.charset.Charset;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import okhttp3.*;
import okio.BufferedSink;

/** 专用Feign传输：上传直接从调用方流写入socket；不缓存整文件、不关闭调用方输入流、不重试。 */
public final class PlatformStreamingClient implements Client {
    public static final class Upload {
        final InputStream input;
        final long size;
        final String type;

        Upload(InputStream input, long size, String type) {
            this.input = input;
            this.size = size;
            this.type = type;
        }
    }

    private static final ThreadLocal<Upload> UPLOAD = new ThreadLocal<>();

    public static Upload upload() {
        return UPLOAD.get();
    }

    public static <T> T withUpload(InputStream input, long size, String type, Supplier<T> request) {
        if (UPLOAD.get() != null) throw new IllegalStateException("Nested file upload");
        UPLOAD.set(new Upload(input, size, type));
        try {
            return request.get();
        } finally {
            UPLOAD.remove();
        }
    }

    private final OkHttpClient http =
            new OkHttpClient.Builder()
                    .retryOnConnectionFailure(false)
                    .followRedirects(false)
                    .followSslRedirects(false)
                    .build();

    @Override
    public Response execute(Request request, Request.Options options) throws IOException {
        Upload upload = UPLOAD.get();
        if (upload == null) return new feign.okhttp.OkHttpClient(http).execute(request, options);
        okhttp3.Request.Builder builder = new okhttp3.Request.Builder().url(request.url());
        for (Map.Entry<String, Collection<String>> header : request.headers().entrySet())
            if (!"Content-Length".equalsIgnoreCase(header.getKey())
                    && !"Content-Type".equalsIgnoreCase(header.getKey()))
                for (String value : header.getValue()) builder.addHeader(header.getKey(), value);
        RequestBody body =
                new RequestBody() {
                    public MediaType contentType() {
                        return MediaType.parse(upload.type);
                    }

                    public long contentLength() {
                        return upload.size < 0 ? -1 : upload.size;
                    }

                    public boolean isOneShot() {
                        return true;
                    }

                    public void writeTo(BufferedSink sink) throws IOException {
                        byte[] bytes = new byte[8192];
                        int read;
                        while ((read = upload.input.read(bytes)) != -1) sink.write(bytes, 0, read);
                    }
                };
        okhttp3.Response received =
                http.newBuilder()
                        .connectTimeout(options.connectTimeoutMillis(), TimeUnit.MILLISECONDS)
                        .readTimeout(options.readTimeoutMillis(), TimeUnit.MILLISECONDS)
                        .writeTimeout(options.readTimeoutMillis(), TimeUnit.MILLISECONDS)
                        .build()
                        .newCall(builder.method(request.httpMethod().name(), body).build())
                        .execute();
        ResponseBody responseBody = received.body();
        return Response.builder()
                .request(request)
                .status(received.code())
                .reason(received.message())
                .headers(
                        new LinkedHashMap<String, Collection<String>>(
                                received.headers().toMultimap()))
                .body(
                        new Response.Body() {
                            public Integer length() {
                                long length =
                                        responseBody == null ? 0 : responseBody.contentLength();
                                return length < 0 || length > Integer.MAX_VALUE
                                        ? null
                                        : (int) length;
                            }

                            public boolean isRepeatable() {
                                return false;
                            }

                            public InputStream asInputStream() {
                                return responseBody == null
                                        ? new ByteArrayInputStream(new byte[0])
                                        : responseBody.byteStream();
                            }

                            public Reader asReader(Charset charset) {
                                return new InputStreamReader(asInputStream(), charset);
                            }

                            public void close() {
                                received.close();
                            }
                        })
                .build();
    }
}
