package com.iwhalecloud.byai.manager.qo.skillgroup;

import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
public class SkillGroupInstallQo {

    @NotNull
    private Long digitalEmployeeId;

    @NotNull
    private Long groupId;
}
