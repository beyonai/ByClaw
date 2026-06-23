package com.iwhalecloud.byai.manager.dto.digitemploy;

import lombok.Data;

import java.util.List;

@Data
public class SkillMetaPromptGenerateResult {

    private String skillName;

    private String description;

    private String whenToUse;

    private List<String> allowedTools;

    private List<String> invocationKeywords;

    private String frontmatterYaml;

    private String skillMdDraft;

    private String retrievalRationale;

    private List<String> qualityChecklist;

    private List<String> improvementNotes;
}
