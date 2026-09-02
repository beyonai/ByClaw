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

    @NotEmpty(message = "data不能为空")
    @Size(max = 100, message = "data顶层字段数不能超过100")
    private Map<String, Object> data;

    @NotNull(message = "version不能为空")
    @Min(value = 1, message = "version必须大于等于1")
    private Integer version;
}
