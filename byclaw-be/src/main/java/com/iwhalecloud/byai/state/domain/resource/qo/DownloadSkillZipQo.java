package com.iwhalecloud.byai.state.domain.resource.qo;

import lombok.Data;

/**
 * skill 下载入参。同时支持 application/json body 与 query/form 形式：
 * - body 形式：{"skillId":456} 或 {"skillPath":"...","resourceId":123,"userCode":"..."}
 * - query 形式：?skillId=456 或 ?skillPath=...&resourceId=123&userCode=...
 *
 * @author qin.guoquan
 * @date 2026-05-15
 */
@Data
public class DownloadSkillZipQo {

    /** 资源中心个人目录技能；身份只取当前登录用户，不回退默认数字员工。 */
    private Boolean personalWorkspace;


    /**
     * 技能资源ID；优先使用该字段直接下载资源化技能包。
     */
    private Long skillId;

    /**
     * skill 目录路径，必须落在 /.openclaw/workspace/skills/ 之下。
     * 例：/.openclaw/workspace/skills/fol-auto-biztravel
     */
    private String skillPath;

    /**
     * 数字员工资源ID；用于定位 agent skills 根目录。
     */
    private Long resourceId;

    /**
     * 目标用户编码；留空则使用当前登录用户。
     */
    private String userCode;
}
