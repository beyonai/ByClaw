package com.iwhalecloud.byai.manager.qo.skillgroup;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class SkillGroupUpdateQo {

    @NotNull
    private Long groupId;

    @NotBlank
    @Size(max = 300)
    private String resourceName;

    @Size(max = 4000)
    private String resourceDesc;

    @Size(max = 1024)
    private String avatar;

    private Long catalogId;
}
