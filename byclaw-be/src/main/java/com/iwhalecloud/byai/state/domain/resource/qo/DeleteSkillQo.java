package com.iwhalecloud.byai.state.domain.resource.qo;

import lombok.Data;

/**
 * 删除 skill 入参。
 *
 * @author qin.guoquan
 * @date 2026-05-20
 */
@Data
public class DeleteSkillQo {

    /** 资源中心个人目录技能；身份只取当前登录用户，不回退默认数字员工。 */
    private Boolean personalWorkspace;


    /**
     * skill 根目录路径，例如：
     * - 数字员工：/.openclaw/workspace-baiying-agent-10000417/skills/fol-auto-biztravel
     * - 超级助手：/.openclaw/workspace/skills/assistant-core
     */
    private String skillPath;

    /**
     * 数字员工资源ID；超级助手可不传。
     */
    private Long resourceId;

    /**
     * 目标用户编码；留空则使用当前登录用户。
     */
    private String userCode;
}
