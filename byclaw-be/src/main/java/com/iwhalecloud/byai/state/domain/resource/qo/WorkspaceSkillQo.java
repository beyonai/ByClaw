package com.iwhalecloud.byai.state.domain.resource.qo;

import lombok.Data;

/**
 * 工作空间目录技能操作入参。
 *
 * @author qin.guoquan
 * @date 2026-06-21 17:38:38
 */
@Data
public class WorkspaceSkillQo {

    /**
     * skill 根目录路径。
     */
    private String skillPath;

    /**
     * 数字员工资源ID；为空时使用当前用户默认数字员工。
     */
    private Long resourceId;

    /**
     * 目标用户编码；留空则使用当前登录用户。
     */
    private String userCode;

    /**
     * 是否确认覆盖同编码个人技能。
     */
    private Boolean overwriteConfirmed;
}
