package com.iwhalecloud.byai.state.domain.artifact.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.Map;
import lombok.Getter;
import lombok.Setter;

/**
 * Requests creation of one record in an Artifact-owned logical collection.
 */
@Getter
@Setter
public class ArtifactDataCreateRequest {

    @NotBlank(message = "{artifact.collectionName.required}")
    @Pattern(regexp = "[A-Za-z][A-Za-z0-9_-]{0,63}",
        message = "{artifact.collectionNameInvalid}")
    private String collectionName;

    @NotEmpty(message = "{artifact.data.required}")
    @Size(max = 100, message = "{artifact.data.tooManyFields}")
    private Map<String, Object> data;
}
