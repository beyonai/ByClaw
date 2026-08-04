package com.iwhalecloud.byai.manager.qo.skillgroup;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import lombok.Data;

@Data
public class SkillGroupMemberChangeQo {

    @NotNull
    private Long groupId;

    @NotEmpty
    private List<@NotNull Long> skillIds;
}
