package com.iwhalecloud.byai.state.domain.artifact.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.Map;
import lombok.Getter;
import lombok.Setter;

/**
 * Replaces the JSON payload of an existing Artifact data record using optimistic locking.
 */
@Getter
@Setter
public class ArtifactDataUpdateRequest {

    @NotEmpty(message = "{artifact.data.required}")
    @Size(max = 100, message = "{artifact.data.tooManyFields}")
    private Map<String, Object> data;

    @NotNull(message = "{artifact.version.required}")
    @Min(value = 1, message = "{artifact.version.min}")
    private Integer version;
}
