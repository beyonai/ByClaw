package com.iwhalecloud.byai.manager.qo.skillgroup;

import com.iwhalecloud.byai.manager.domain.skillgroup.model.SkillGroupUninstallMode;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
public class SkillGroupUninstallQo {

    @NotNull
    private Long digitalEmployeeId;

    @NotNull
    private Long groupId;

    private SkillGroupUninstallMode mode = SkillGroupUninstallMode.PRESERVE_SHARED;

    private String previewToken;
}
