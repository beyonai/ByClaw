package com.iwhalecloud.byai.state.domain.artifact.service;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Locale;
import java.util.Set;
import org.springframework.http.MediaType;
import org.springframework.http.MediaTypeFactory;

/**
 * Resolves response media types without trusting the caller-provided multipart content type.
 */
public final class ArtifactMediaTypeResolver {

    private static final Set<String> INLINE_EXTENSIONS = Set.of(
        "html", "htm", "css", "js", "mjs", "json", "txt", "md", "xml", "svg",
        "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "pdf", "mp3", "wav", "ogg", "mp4", "webm"
    );

    private ArtifactMediaTypeResolver() {
    }

    public static String resolve(String fileName) {
        return MediaTypeFactory.getMediaType(fileName)
            .orElse(MediaType.APPLICATION_OCTET_STREAM)
            .toString();
    }

    /**
     * Uses a small set of stable file signatures before falling back to the extension.
     */
    public static String resolve(String fileName, byte[] prefix) {
        byte[] value = prefix == null ? new byte[0] : prefix;
        if (startsWith(value, "%PDF-".getBytes(StandardCharsets.US_ASCII))) {
            return MediaType.APPLICATION_PDF_VALUE;
        }
        if (startsWith(value, new byte[] {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A})) {
            return MediaType.IMAGE_PNG_VALUE;
        }
        if (startsWith(value, new byte[] {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF})) {
            return MediaType.IMAGE_JPEG_VALUE;
        }
        if (startsWith(value, "GIF87a".getBytes(StandardCharsets.US_ASCII))
            || startsWith(value, "GIF89a".getBytes(StandardCharsets.US_ASCII))) {
            return MediaType.IMAGE_GIF_VALUE;
        }
        String text = new String(value, StandardCharsets.UTF_8).stripLeading().toLowerCase(Locale.ROOT);
        if (text.startsWith("<!doctype html") || text.startsWith("<html")) {
            return MediaType.TEXT_HTML_VALUE;
        }
        return resolve(fileName);
    }

    private static boolean startsWith(byte[] value, byte[] signature) {
        return value.length >= signature.length
            && Arrays.equals(Arrays.copyOf(value, signature.length), signature);
    }

    public static boolean shouldInline(String fileName) {
        int separator = fileName == null ? -1 : fileName.lastIndexOf('.');
        if (separator < 0 || separator == fileName.length() - 1) {
            return false;
        }
        return INLINE_EXTENSIONS.contains(fileName.substring(separator + 1).toLowerCase(Locale.ROOT));
    }

    public static boolean isHtml(String fileName) {
        String normalized = fileName == null ? "" : fileName.toLowerCase(Locale.ROOT);
        return normalized.endsWith(".html") || normalized.endsWith(".htm");
    }
}
