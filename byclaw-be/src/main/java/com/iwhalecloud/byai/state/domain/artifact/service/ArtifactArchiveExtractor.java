package com.iwhalecloud.byai.state.domain.artifact.service;

import com.iwhalecloud.byai.state.domain.artifact.config.ArtifactProperties;
import com.iwhalecloud.byai.state.domain.artifact.storage.ArtifactStoragePort;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.apache.commons.compress.archivers.zip.ZipArchiveEntry;
import org.apache.commons.compress.archivers.zip.ZipFile;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

/**
 * Extracts ZIP entries through bounded temporary files and publishes validated objects through the storage port.
 */
@Component
public class ArtifactArchiveExtractor {

    private static final int ZIP_UNIX_FILE_TYPE_MASK = 0170000;
    private static final int ZIP_UNIX_REGULAR_FILE = 0100000;
    private static final int ZIP_UNIX_DIRECTORY = 0040000;
    private static final long MAX_WARNING_SCAN_BYTES = 2L * 1024L * 1024L;
    private static final Pattern ROOT_ABSOLUTE_REFERENCE = Pattern.compile(
        "(?i)(?:src|href|action)\\s*=\\s*['\"]/(?!/)|url\\(\\s*['\"]?/(?!/)"
    );

    private final ArtifactProperties properties;
    private final ArtifactStoragePort storage;

    public ArtifactArchiveExtractor(ArtifactProperties properties, ArtifactStoragePort storage) {
        this.properties = properties;
        this.storage = storage;
    }

    public ExtractionResult extract(MultipartFile archive, boolean stripTopLevelDirectory, String storageType,
        String storageRoot, String contentPrefix) throws IOException {
        Path temporaryDirectory = Files.createTempDirectory("byclaw-artifact-");
        Path archiveFile = temporaryDirectory.resolve("upload.zip");
        List<String> writtenPaths = new ArrayList<>();
        List<String> warnings = new ArrayList<>();
        long totalExpanded = 0L;
        int entryCount = 0;
        try {
            try (InputStream input = archive.getInputStream();
                 OutputStream output = Files.newOutputStream(archiveFile, StandardOpenOption.CREATE_NEW)) {
                copyBounded(input, output, properties.getMaxUploadBytes());
            }
            try (ZipFile zip = new ZipFile(archiveFile.toFile())) {
                ArchiveLayout layout = inspect(zip, stripTopLevelDirectory);
                Enumeration<ZipArchiveEntry> entries = zip.getEntries();
                while (entries.hasMoreElements()) {
                    ZipArchiveEntry entry = entries.nextElement();
                    entryCount++;
                    if (entryCount > properties.getMaxEntries()) {
                        throw new IllegalArgumentException("ZIP文件数量超过限制: " + properties.getMaxEntries());
                    }
                    if (!zip.canReadEntryData(entry)) {
                        throw new IllegalArgumentException("ZIP包含无法读取的条目: " + entry.getName());
                    }
                    String relativePath = normalizedEntryPath(entry.getName(), layout.strippedTopLevelDirectory());
                    validateEntry(entry, relativePath);
                    if (relativePath.isBlank() || entry.isDirectory()) {
                        continue;
                    }

                    Path temporaryFile = Files.createTempFile(temporaryDirectory, "entry-", ".tmp");
                    long entrySize;
                    try (InputStream entryInput = zip.getInputStream(entry);
                         OutputStream output = Files.newOutputStream(temporaryFile,
                             StandardOpenOption.TRUNCATE_EXISTING)) {
                        entrySize = copyBounded(entryInput, output, properties.getMaxEntryBytes());
                    }
                    totalExpanded = Math.addExact(totalExpanded, entrySize);
                    if (totalExpanded > properties.getMaxExpandedBytes()) {
                        throw new IllegalArgumentException("ZIP解压后总大小超过限制");
                    }
                    if (archive.getSize() > 0
                        && totalExpanded > archive.getSize() * (long) properties.getMaxCompressionRatio()) {
                        throw new IllegalArgumentException("ZIP压缩率超过限制");
                    }

                    String objectKey = join(contentPrefix, relativePath);
                    byte[] prefix;
                    try (InputStream input = Files.newInputStream(temporaryFile)) {
                        prefix = input.readNBytes(512);
                    }
                    String contentType = ArtifactMediaTypeResolver.resolve(relativePath, prefix);
                    try (InputStream input = Files.newInputStream(temporaryFile)) {
                        storage.put(storageType, storageRoot, objectKey, input, entrySize, contentType);
                    }
                    writtenPaths.add(relativePath);
                    collectPathWarning(relativePath, temporaryFile, entrySize, warnings);
                    Files.deleteIfExists(temporaryFile);
                }
            }
        }
        catch (ArithmeticException e) {
            throw new IllegalArgumentException("ZIP解压后大小溢出", e);
        }
        finally {
            deleteTemporaryDirectory(temporaryDirectory);
        }
        return new ExtractionResult(totalExpanded, writtenPaths, warnings);
    }

    private ArchiveLayout inspect(ZipFile zip, boolean stripTopLevelDirectory) {
        int count = 0;
        String commonTopLevel = null;
        boolean canStrip = stripTopLevelDirectory;
        Enumeration<ZipArchiveEntry> entries = zip.getEntries();
        while (entries.hasMoreElements()) {
            ZipArchiveEntry entry = entries.nextElement();
            count++;
            if (count > properties.getMaxEntries()) {
                throw new IllegalArgumentException("ZIP文件数量超过限制: " + properties.getMaxEntries());
            }
            if (!zip.canReadEntryData(entry)) {
                throw new IllegalArgumentException("ZIP包含无法读取的条目: " + entry.getName());
            }
            String path = normalizedEntryPath(entry.getName(), null);
            validateEntry(entry, path);
            if (path.isBlank()) {
                continue;
            }
            int slash = path.indexOf('/');
            if (slash < 0) {
                canStrip = false;
                continue;
            }
            String topLevel = path.substring(0, slash);
            if (commonTopLevel == null) {
                commonTopLevel = topLevel;
            }
            else if (!commonTopLevel.equals(topLevel)) {
                canStrip = false;
            }
        }
        if (count == 0) {
            throw new IllegalArgumentException("ZIP文件为空或格式无效");
        }
        return new ArchiveLayout(canStrip ? commonTopLevel : null);
    }

    private void validateEntry(ZipArchiveEntry entry, String relativePath) {
        if (entry.isUnixSymlink()) {
            throw new IllegalArgumentException("ZIP不允许包含符号链接: " + entry.getName());
        }
        int unixType = entry.getUnixMode() & ZIP_UNIX_FILE_TYPE_MASK;
        if (unixType != 0 && unixType != ZIP_UNIX_REGULAR_FILE && unixType != ZIP_UNIX_DIRECTORY) {
            throw new IllegalArgumentException("ZIP不允许包含特殊文件: " + entry.getName());
        }
        int depth = relativePath.isBlank() ? 0 : relativePath.split("/").length;
        if (depth > properties.getMaxDepth()) {
            throw new IllegalArgumentException("ZIP目录深度超过限制: " + relativePath);
        }
    }

    private String normalizedEntryPath(String entryName, String strippedTopLevelDirectory) {
        String value = entryName == null ? "" : entryName.replace('\\', '/');
        if (value.startsWith("/") || value.matches("^[A-Za-z]:.*")) {
            throw new IllegalArgumentException("ZIP包含绝对路径: " + entryName);
        }
        for (String segment : value.split("/")) {
            if ("..".equals(segment)) {
                throw new IllegalArgumentException("ZIP包含路径穿越: " + entryName);
            }
        }
        while (value.startsWith("./")) {
            value = value.substring(2);
        }
        if (strippedTopLevelDirectory != null) {
            String prefix = strippedTopLevelDirectory + "/";
            if (value.equals(strippedTopLevelDirectory) || value.equals(prefix)) {
                return "";
            }
            if (value.startsWith(prefix)) {
                value = value.substring(prefix.length());
            }
        }
        return value;
    }

    private long copyBounded(InputStream input, OutputStream output, long maximumBytes) throws IOException {
        byte[] buffer = new byte[8192];
        long total = 0L;
        int read;
        while ((read = input.read(buffer)) != -1) {
            total += read;
            if (total > maximumBytes) {
                throw new IllegalArgumentException("ZIP单文件大小超过限制");
            }
            output.write(buffer, 0, read);
        }
        return total;
    }

    private void collectPathWarning(String relativePath, Path file, long size, List<String> warnings)
        throws IOException {
        String normalized = relativePath.toLowerCase(Locale.ROOT);
        if (size > MAX_WARNING_SCAN_BYTES
            || !(normalized.endsWith(".html") || normalized.endsWith(".htm") || normalized.endsWith(".css"))) {
            return;
        }
        String content = Files.readString(file, StandardCharsets.UTF_8);
        if (ROOT_ABSOLUTE_REFERENCE.matcher(content).find()) {
            warnings.add("检测到根绝对资源路径，path预览模式下可能无法加载: " + relativePath);
        }
    }

    private String join(String prefix, String path) {
        return prefix.replaceAll("/+$", "") + "/" + path.replaceAll("^/+", "");
    }

    private void deleteTemporaryDirectory(Path directory) {
        if (directory == null || !Files.exists(directory)) {
            return;
        }
        try (Stream<Path> paths = Files.walk(directory)) {
            paths.sorted((left, right) -> right.compareTo(left)).forEach(path -> {
                try {
                    Files.deleteIfExists(path);
                }
                catch (IOException ignored) {
                    // Temporary files are best-effort cleanup and never replace the original publish failure.
                }
            });
        }
        catch (IOException ignored) {
            // The operating system temporary-file cleanup remains the final fallback.
        }
    }

    private record ArchiveLayout(String strippedTopLevelDirectory) {
    }

    public record ExtractionResult(long expandedSize, List<String> paths, List<String> warnings) {

        public ExtractionResult {
            paths = List.copyOf(paths);
            warnings = List.copyOf(new HashSet<>(warnings));
        }
    }
}
