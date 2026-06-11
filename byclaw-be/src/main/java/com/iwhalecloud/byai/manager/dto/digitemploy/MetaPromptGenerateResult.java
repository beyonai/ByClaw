package com.iwhalecloud.byai.manager.dto.digitemploy;

import lombok.Data;

import java.util.Map;

@Data
public class MetaPromptGenerateResult {

    private Map<String, Object> fields;

    private ContextSummary contextSummary;

    @Data
    public static class ContextSummary {
        private int availableToolkitCount;
        private int availableMcpCount;
        private int availableKnowledgeCount;
        private int availableAgentCount;
        private int bundledSkillCount;
    }
}
