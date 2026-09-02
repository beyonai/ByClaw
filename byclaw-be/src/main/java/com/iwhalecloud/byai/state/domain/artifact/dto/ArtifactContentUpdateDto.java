package com.iwhalecloud.byai.state.domain.artifact.dto;

import lombok.Builder;
import lombok.Getter;

/**
 * Minimal acknowledgement returned after an existing Artifact switches to validated replacement content.
 */
@Getter
@Builder
public class ArtifactContentUpdateDto {

    private boolean ok;

    private String operation;

    private String status;
}
