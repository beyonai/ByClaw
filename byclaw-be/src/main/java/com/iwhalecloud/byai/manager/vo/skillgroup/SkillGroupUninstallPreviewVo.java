package com.iwhalecloud.byai.manager.vo.skillgroup;

import java.util.ArrayList;
import java.util.List;
import lombok.Data;

@Data
public class SkillGroupUninstallPreviewVo {

    private Boolean installedByGroup;

    private String previewToken;

    private List<SkillGroupUninstallSkillVo> exclusiveSkills = new ArrayList<>();

    private List<SkillGroupUninstallSkillVo> sharedSkills = new ArrayList<>();

    private Integer affectedCount;
}
