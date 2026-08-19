package com.iwhalecloud.byai.state.domain.artifact.dto;

import java.time.OffsetDateTime;
import java.util.List;
import lombok.Builder;
import lombok.Getter;

/**
 * Public artifact metadata returned by upload and owner-management endpoints.
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

    private OffsetDateTime expiresAt;

    private List<String> warnings;
}
