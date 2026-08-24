package com.iwhalecloud.byai.manager.qo.skillgroup;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class SkillGroupCandidatePageQo {

    private Long groupId;

    @Min(1)
    private Integer pageNum = 1;

    @Min(1)
    @Max(100)
    private Integer pageSize = 10;

    @Size(max = 300)
    private String keyword;
}
