package com.iwhalecloud.byai.state.interfaces.controller.artifact;

import com.iwhalecloud.byai.state.domain.artifact.service.ArtifactApplicationService;
import com.iwhalecloud.byai.state.domain.artifact.service.ArtifactApplicationService.ArtifactContent;
import com.iwhalecloud.byai.state.domain.artifact.service.ArtifactMediaTypeResolver;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import org.apache.commons.lang3.StringUtils;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

/**
 * Anonymous capability endpoints for browser preview and original-file download.
 */
@RestController
public class ArtifactContentController {

    private static final int COPY_BUFFER_SIZE = 64 * 1024;

    private final ArtifactApplicationService artifactApplicationService;

    public ArtifactContentController(ArtifactApplicationService artifactApplicationService) {
        this.artifactApplicationService = artifactApplicationService;
    }

    @RequestMapping(value = {
        "${artifact.preview.path-prefix:/artifact-preview}/{artifactId}/{accessKey}",
        "${artifact.preview.path-prefix:/artifact-preview}/{artifactId}/{accessKey}/",
        "${artifact.preview.path-prefix:/artifact-preview}/{artifactId}/{accessKey}/{*resourcePath}"
    }, method = {RequestMethod.GET, RequestMethod.HEAD})
    public ResponseEntity<StreamingResponseBody> preview(@PathVariable("artifactId") String artifactId,
        @PathVariable("accessKey") String accessKey,
        @PathVariable(value = "resourcePath", required = false) String resourcePath,
        HttpServletRequest request) {
        ArtifactContent content;
        try {
            content = artifactApplicationService.resolvePreview(artifactId, accessKey, resourcePath);
        }
        catch (IllegalArgumentException e) {
            content = null;
        }
        return content == null ? notFound() : serve(content, request, false);
    }

    @RequestMapping(value = "${artifact.download.path-prefix:/artifact-download}/{artifactId}/{accessKey}",
        method = {RequestMethod.GET, RequestMethod.HEAD})
    public ResponseEntity<StreamingResponseBody> download(@PathVariable("artifactId") String artifactId,
        @PathVariable("accessKey") String accessKey, HttpServletRequest request) {
        ArtifactContent content = artifactApplicationService.resolveDownload(artifactId, accessKey);
        return content == null ? notFound() : serve(content, request, true);
    }

    private ResponseEntity<StreamingResponseBody> serve(ArtifactContent content, HttpServletRequest request,
        boolean download) {
        long totalSize = content.metadata().getFileSize() == null
            ? content.record().getFileSize() : content.metadata().getFileSize();
        HttpHeaders headers = responseHeaders(content, download);
        String ifNoneMatch = request.getHeader(HttpHeaders.IF_NONE_MATCH);
        if ("*".equals(ifNoneMatch) || headers.getETag().equals(ifNoneMatch)) {
            return new ResponseEntity<>(null, headers, HttpStatus.NOT_MODIFIED);
        }
        ByteRange range;
        try {
            range = parseRange(request.getHeader(HttpHeaders.RANGE), totalSize);
        }
        catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                .header(HttpHeaders.CONTENT_RANGE, "bytes */" + totalSize)
                .build();
        }

        headers.setContentLength(range.length());
        headers.set(HttpHeaders.ACCEPT_RANGES, "bytes");
        if (range.partial()) {
            headers.set(HttpHeaders.CONTENT_RANGE,
                "bytes " + range.start() + "-" + range.end() + "/" + totalSize);
        }
        if (HttpMethod.HEAD.matches(request.getMethod())) {
            return new ResponseEntity<>(null, headers, range.partial() ? HttpStatus.PARTIAL_CONTENT : HttpStatus.OK);
        }

        StreamingResponseBody body = output -> {
            try (InputStream input = artifactApplicationService.open(content, range.start(), range.length())) {
                copy(input, output, range.length());
            }
        };
        return new ResponseEntity<>(body, headers, range.partial() ? HttpStatus.PARTIAL_CONTENT : HttpStatus.OK);
    }

    private HttpHeaders responseHeaders(ArtifactContent content, boolean download) {
        HttpHeaders headers = new HttpHeaders();
        String storedContentType = content.objectKey().equals(content.record().getOriginalKey())
            ? content.record().getContentType() : content.metadata().getContentType();
        String mediaType = StringUtils.defaultIfBlank(storedContentType,
            ArtifactMediaTypeResolver.resolve(content.fileName()));
        headers.setContentType(MediaType.parseMediaType(mediaType));
        boolean inline = !download && ArtifactMediaTypeResolver.shouldInline(content.fileName());
        ContentDisposition disposition = inline
            ? ContentDisposition.inline().filename(content.fileName(), StandardCharsets.UTF_8).build()
            : ContentDisposition.attachment().filename(content.fileName(), StandardCharsets.UTF_8).build();
        headers.setContentDisposition(disposition);
        headers.set("X-Content-Type-Options", "nosniff");
        headers.set("Referrer-Policy", "no-referrer");
        headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
        if (ArtifactMediaTypeResolver.isHtml(content.fileName())) {
            headers.setCacheControl("no-cache");
        }
        else {
            headers.setCacheControl("private, max-age=3600");
        }
        String lastModified = content.metadata().getLastModified();
        if (StringUtils.isNotBlank(lastModified)) {
            try {
                headers.setLastModified(Instant.parse(lastModified).toEpochMilli());
            }
            catch (Exception ignored) {
                // Storage backends may expose non-ISO timestamps; Last-Modified is optional.
            }
        }
        String etagSeed = content.record().getArtifactId() + ':' + content.objectKey() + ':'
            + content.metadata().getFileSize() + ':' + StringUtils.defaultString(lastModified);
        headers.setETag("W/\"" + Integer.toHexString(etagSeed.hashCode()) + "\"");
        return headers;
    }

    private ByteRange parseRange(String header, long totalSize) {
        if (totalSize < 0) {
            throw new IllegalArgumentException("文件大小无效");
        }
        if (StringUtils.isBlank(header)) {
            return new ByteRange(0L, Math.max(0L, totalSize - 1L), false, totalSize);
        }
        if (!header.startsWith("bytes=") || header.contains(",") || totalSize == 0) {
            throw new IllegalArgumentException("仅支持单个bytes区间");
        }
        String value = header.substring("bytes=".length()).trim();
        int separator = value.indexOf('-');
        if (separator < 0) {
            throw new IllegalArgumentException("Range格式无效");
        }
        String startValue = value.substring(0, separator).trim();
        String endValue = value.substring(separator + 1).trim();
        long start;
        long end;
        try {
            if (startValue.isBlank()) {
                long suffixLength = Long.parseLong(endValue);
                if (suffixLength <= 0) {
                    throw new IllegalArgumentException("Range格式无效");
                }
                start = Math.max(0L, totalSize - suffixLength);
                end = totalSize - 1L;
            }
            else {
                start = Long.parseLong(startValue);
                end = endValue.isBlank() ? totalSize - 1L : Long.parseLong(endValue);
            }
        }
        catch (NumberFormatException e) {
            throw new IllegalArgumentException("Range格式无效", e);
        }
        if (start < 0 || start >= totalSize || end < start) {
            throw new IllegalArgumentException("Range超出文件范围");
        }
        end = Math.min(end, totalSize - 1L);
        return new ByteRange(start, end, true, end - start + 1L);
    }

    private void copy(InputStream input, java.io.OutputStream output, long length) throws IOException {
        byte[] buffer = new byte[COPY_BUFFER_SIZE];
        long remaining = length;
        while (remaining > 0) {
            int read = input.read(buffer, 0, (int) Math.min(buffer.length, remaining));
            if (read < 0) {
                break;
            }
            output.write(buffer, 0, read);
            remaining -= read;
        }
    }

    private ResponseEntity<StreamingResponseBody> notFound() {
        return ResponseEntity.notFound().build();
    }

    private record ByteRange(long start, long end, boolean partial, long length) {
    }
}
