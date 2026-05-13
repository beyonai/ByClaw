package com.iwhalecloud.byai.state.domain.session.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.Setter;

/**
 * 用户工作空间下的 skill 信息。
 *
 * @author qin.guoquan
 * @date 2026-04-28 18:45:00
 */
@Getter
@Setter
@AllArgsConstructor
public class ByClawSkillDto {

    /**
     * skill 目录名，例如 baiying。
     */
    private String skillName;

    /**
     * skill 根目录对象路径，例如
     * /.openclaw/workspace-baiying-agent-10000417/skills/baiying
     */
    private String skillPath;

    /**
     * SKILL.md 对象键；若不存在则为空。
     */
    private String skillDocObjectKey;
}
