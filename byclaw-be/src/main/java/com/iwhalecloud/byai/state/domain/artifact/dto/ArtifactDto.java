package com.iwhalecloud.byai.state.domain.artifact.dto;

import java.time.OffsetDateTime;
import java.util.List;
import lombok.Builder;
import lombok.Getter;

/**
 * Artifact metadata returned by publication and owner-management endpoints.
 */
@Getter
@Builder
public class ArtifactDto {

    private String artifactId;

    private String kind;

    private String status;

    private String fileName;

    private String entryPoint;

    private Long size;

    private String sha256;

    private String previewUrl;

    private String downloadUrl;

    /**
     * Management capability returned only by the initial publication response.
     */
    private String accessKey;

    private OffsetDateTime expiresAt;

    private OffsetDateTime purgeAt;

    private List<String> warnings;
}
