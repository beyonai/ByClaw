package com.iwhalecloud.byai.manager.vo.skillgroup;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import java.util.ArrayList;
import java.util.List;
import lombok.Data;

@Data
public class SkillGroupInstallResultVo {

    private Boolean confirmationRequired;

    private Boolean installedByGroup;

    private SkillGroupUninstallPreviewVo uninstallPreview;

    @JsonSerialize(contentUsing = ToStringSerializer.class)
    private List<Long> affectedOtherGroupIds = new ArrayList<>();

    @JsonSerialize(contentUsing = ToStringSerializer.class)
    private List<Long> installedSkillIds = new ArrayList<>();

    @JsonSerialize(contentUsing = ToStringSerializer.class)
    private List<Long> existingSkillIds = new ArrayList<>();

    @JsonSerialize(contentUsing = ToStringSerializer.class)
    private List<Long> removedSkillIds = new ArrayList<>();

    @JsonSerialize(contentUsing = ToStringSerializer.class)
    private List<Long> retainedSkillIds = new ArrayList<>();

    @JsonSerialize(contentUsing = ToStringSerializer.class)
    private List<Long> totalSkillIds = new ArrayList<>();

    @JsonSerialize(contentUsing = ToStringSerializer.class)
    private List<Long> appliedSkillIds = new ArrayList<>();

    @JsonSerialize(contentUsing = ToStringSerializer.class)
    private List<Long> pendingSkillIds = new ArrayList<>();

    @JsonSerialize(contentUsing = ToStringSerializer.class)
    private List<Long> unavailableSkillIds = new ArrayList<>();

    private SkillGroupMemberStatusSummaryVo summary;
}
