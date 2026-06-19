package com.iwhalecloud.byai.manager.dto.digitemploy;

import lombok.Data;

import java.util.List;

@Data
public class SkillMetaPromptGenerateRequest {

    private String skillName;

    private String skillGoal;

    private String targetUsers;

    private String triggerScenarios;

    private String nonTriggerScenarios;

    private String mainActions;

    private String inputsAndOutputs;

    private List<String> allowedTools;

    private String constraints;

    private String existingSkillMd;

    private String referenceText;

    private String lang;

    private String language;

    private String modelCode;

    public String resolvedLang() {
        if (lang != null && !lang.isBlank()) {
            return lang.startsWith("zh") ? "zh" : "en";
        }
        if (language != null && !language.isBlank()) {
            return language.startsWith("zh") ? "zh" : "en";
        }
        return "zh";
    }
}
