package com.iwhalecloud.byai.state.domain.resource.qo;

import lombok.Data;

/**
 * skill 下载入参。同时支持 application/json body 与 query/form 形式：
 * - body 形式：{"skillPath":"...","userCode":"..."}
 * - query 形式：?skillPath=...&userCode=...
 *
 * @author qin.guoquan
 * @date 2026-05-15
 */
@Data
public class DownloadSkillZipQo {

    /**
     * skill 目录路径，必须落在 /.openclaw/workspace/skills/ 之下。
     * 例：/.openclaw/workspace/skills/fol-auto-biztravel
     */
    private String skillPath;

    /**
     * 目标用户编码；留空则使用当前登录用户。
     */
    private String userCode;
}
