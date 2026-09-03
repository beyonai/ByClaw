package com.iwhalecloud.byai.state.domain.artifact.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * Renews an Artifact's public access window relative to the current time.
 */
@Getter
@Setter
public class ArtifactExpiryRenewRequest {

    @NotNull(message = "expiresInSeconds不能为空")
    @Min(value = 1, message = "expiresInSeconds必须大于0")
    private Long expiresInSeconds;
}
