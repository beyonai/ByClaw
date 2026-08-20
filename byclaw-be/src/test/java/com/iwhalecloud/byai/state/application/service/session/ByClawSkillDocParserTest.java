package com.iwhalecloud.byai.state.application.service.session;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class ByClawSkillDocParserTest {

    @Test
    void shouldReadFoldedYamlDescriptionBodyInsteadOfBlockMarker() {
        String skillDoc = """
            ---
            name: ppt-master
            description: >
              AI-driven presentation workflow for generating editable PPTX decks and
              slides, reconstructing page visuals and filling native PPTX templates.
            metadata:
              version: "4.8.0-baiying.1"
            ---
            # PPT Master
            """;

        assertEquals(
            "AI-driven presentation workflow for generating editable PPTX decks and slides, "
                + "reconstructing page visuals and filling native PPTX templates.",
            ByClawSkillDocParser.extractDescription(skillDoc));
    }

    @Test
    void shouldReadIndentedDescriptionWhenYamlValueIsEmpty() {
        String skillDoc = """
            ---
            name: ppt-master-0.1
            description:
              AI-driven presentation workflow for generating editable PPTX decks and slides,
              reconstructing page visuals and creating reusable workspaces.
              也用于用户提出制作、生成、重构或美化 PPT 的场景。
            metadata:
              version: "4.8.0-baiying.1"
            ---
            # PPT Master
            """;

        assertEquals(
            "AI-driven presentation workflow for generating editable PPTX decks and slides, "
                + "reconstructing page visuals and creating reusable workspaces. "
                + "也用于用户提出制作、生成、重构或美化 PPT 的场景。",
            ByClawSkillDocParser.extractDescription(skillDoc));
    }

    @Test
    void shouldSkipLeadingSymbolOnlyLinesInDescriptionBody() {
        String skillDoc = """
            ---
            name: symbol-prefix
            description: |
              ***
              >>>
              Generate an editable presentation from the user's source material.
              Preserve charts and tables as native objects.
            ---
            # Symbol Prefix
            """;

        assertEquals(
            "Generate an editable presentation from the user's source material. "
                + "Preserve charts and tables as native objects.",
            ByClawSkillDocParser.extractDescription(skillDoc));
    }

    @Test
    void shouldFallbackToMarkdownBodyWhenDescriptionContainsOnlySymbols() {
        String skillDoc = """
            ---
            name: body-fallback
            description: >>>
            ---
            # Body Fallback
            Generate reports from structured data.
            Keep the result editable.
            """;

        assertEquals("Generate reports from structured data. Keep the result editable.",
            ByClawSkillDocParser.extractDescription(skillDoc));
    }

    @Test
    void shouldKeepExistingInlineDescriptionBehavior() {
        String skillDoc = """
            ---
            name: inline-description
            description: Generate editable PPTX presentations.
            ---
            # Inline Description
            """;

        assertEquals("Generate editable PPTX presentations.", ByClawSkillDocParser.extractDescription(skillDoc));
    }
}
