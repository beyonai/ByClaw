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

    @NotBlank(message = "collectionName不能为空")
    @Pattern(regexp = "[A-Za-z][A-Za-z0-9_-]{0,63}",
        message = "collectionName必须以字母开头，且只能包含字母、数字、下划线或连字符")
    private String collectionName;

    @NotEmpty(message = "data不能为空")
    @Size(max = 100, message = "data顶层字段数不能超过100")
    private Map<String, Object> data;
}
