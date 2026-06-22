package com.iwhalecloud.byai.state.domain.session.dto;

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
public class ByClawSkillDto {

    public static final String DISPLAY_SOURCE_TYPE_USER_DEVELOPED = "USER_DEVELOPED";

    public static final String DISPLAY_SOURCE_TYPE_OTHER = "OTHER";

    public static final String DISPLAY_SOURCE_TYPE_LOBSTER_INSTALLED = "LOBSTER_INSTALLED";

    /**
     * 资源ID。目录型技能未资源化前为空。
     */
    private Long resourceId;

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

    /**
     * 从 SKILL.md 提取的描述摘要。
     */
    private String skillDesc;

    /**
     * 目录型技能使用开始时间。优先取 SKILL.md 的最后修改时间。
     */
    private String useStartTime;

    /**
     * 展示来源类型，例如 LOBSTER_INSTALLED。
     */
    private String displaySourceType;

    /**
     * 是否已入 ss_resource / ss_res_ext_skill。
     */
    private Boolean resourceBacked;

    public ByClawSkillDto(String skillName, String skillPath, String skillDocObjectKey) {
        this(skillName, skillPath, skillDocObjectKey, null, null);
    }

    public ByClawSkillDto(String skillName, String skillPath, String skillDocObjectKey, String skillDesc,
        String displaySourceType) {
        this(null, skillName, skillPath, skillDocObjectKey, skillDesc, displaySourceType, false);
    }

    public ByClawSkillDto(Long resourceId, String skillName, String skillPath, String skillDocObjectKey,
        String skillDesc, String displaySourceType, Boolean resourceBacked) {
        this.resourceId = resourceId;
        this.skillName = skillName;
        this.skillPath = skillPath;
        this.skillDocObjectKey = skillDocObjectKey;
        this.skillDesc = skillDesc;
        this.displaySourceType = displaySourceType;
        this.resourceBacked = resourceBacked;
    }
}
