package com.iwhalecloud.byai.state.domain.artifact.config;

import lombok.Getter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Configurable storage, URL, lifecycle, and archive safety limits for artifacts.
 */
@Getter
@Component
public class ArtifactProperties {

    @Value("${artifact.storage.type:${file.storage.type:file}}")
    private String storageType;

    @Value("${artifact.storage.local-root:/mnt/byclaw-artifacts}")
    private String localRoot;

    @Value("${artifact.storage.bucket:byclaw-artifacts}")
    private String bucket;

    @Value("${artifact.preview.public-base-url:}")
    private String publicBaseUrl;

    @Value("${artifact.preview.path-prefix:/artifact-preview}")
    private String previewPathPrefix;

    @Value("${artifact.download.path-prefix:/artifact-download}")
    private String downloadPathPrefix;

    @Value("${artifact.lifecycle.default-expires-seconds:604800}")
    private long defaultExpiresSeconds;

    @Value("${artifact.lifecycle.max-expires-seconds:2592000}")
    private long maxExpiresSeconds;

    @Value("${artifact.archive.max-upload-bytes:314572800}")
    private long maxUploadBytes;

    @Value("${artifact.archive.max-expanded-bytes:1073741824}")
    private long maxExpandedBytes;

    @Value("${artifact.archive.max-entry-bytes:209715200}")
    private long maxEntryBytes;

    @Value("${artifact.archive.max-entries:10000}")
    private int maxEntries;

    @Value("${artifact.archive.max-depth:20}")
    private int maxDepth;

    @Value("${artifact.archive.max-compression-ratio:100}")
    private int maxCompressionRatio;

    @Value("${artifact.cleanup.fixed-delay-ms:3600000}")
    private long cleanupFixedDelayMs;
}
