package com.iwhalecloud.byai.manager.qo.skillgroup;

import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
public class SkillGroupIdQo {

    @NotNull
    private Long groupId;
}
