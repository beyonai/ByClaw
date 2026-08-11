package com.iwhalecloud.byai.manager.vo.skillgroup;

import com.iwhalecloud.byai.manager.domain.skillgroup.model.SkillGroupMemberStatus;
import java.util.ArrayList;
import java.util.List;
import lombok.Data;

@Data
public class SkillGroupMemberStatusSummaryVo {

    private List<SkillGroupMemberVo> members = new ArrayList<>();
    private int installed;
    private int installable;
    private int applyRequired;
    private int applyPending;
    private int unavailable;

    public int getTotal() {
        return members.size();
    }

    public boolean hasPermissionBarrier() {
        return applyRequired > 0 || applyPending > 0 || unavailable > 0;
    }

    public static SkillGroupMemberStatusSummaryVo from(List<SkillGroupMemberVo> evaluatedMembers) {
        SkillGroupMemberStatusSummaryVo summary = new SkillGroupMemberStatusSummaryVo();
        if (evaluatedMembers == null) {
            return summary;
        }
        summary.setMembers(new ArrayList<>(evaluatedMembers));
        for (SkillGroupMemberVo member : evaluatedMembers) {
            SkillGroupMemberStatus status = member == null ? null : member.getMemberStatus();
            if (status == null) {
                continue;
            }
            switch (status) {
                case INSTALLED -> summary.installed++;
                case INSTALLABLE -> summary.installable++;
                case APPLY_REQUIRED -> summary.applyRequired++;
                case APPLY_PENDING -> summary.applyPending++;
                case APPLY_UNAVAILABLE -> summary.unavailable++;
            }
        }
        return summary;
    }
}
