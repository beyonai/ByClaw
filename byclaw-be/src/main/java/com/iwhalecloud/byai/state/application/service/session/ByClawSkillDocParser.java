package com.iwhalecloud.byai.state.application.service.session;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;

import org.apache.commons.lang3.StringUtils;

/**
 * Extracts user-facing metadata from SKILL.md while hiding YAML front matter.
 *
 * @author qin.guoquan
 * @date 2026-06-21 17:38:38
 */
final class ByClawSkillDocParser {

    private ByClawSkillDocParser() {
    }

    static String extractDescription(String content) {
        if (StringUtils.isBlank(content)) {
            return null;
        }
        String frontMatterDescription = extractFrontMatterValue(content, "description");
        if (StringUtils.isNotBlank(frontMatterDescription)) {
            return frontMatterDescription;
        }
        String text = stripFrontMatter(content);
        return text.lines()
            .map(StringUtils::trimToEmpty)
            .filter(StringUtils::isNotBlank)
            .filter(line -> !line.startsWith("#"))
            .limit(3)
            .collect(Collectors.joining(" "));
    }

    private static String extractFrontMatterValue(String content, String key) {
        FrontMatterText frontMatterText = normalizeFrontMatter(content);
        if (!frontMatterText.hasFrontMatter()) {
            return null;
        }
        String[] lines = frontMatterText.text().split("\\R", -1);
        for (int i = frontMatterText.startLine(); i < lines.length; i++) {
            String line = StringUtils.trimToEmpty(lines[i]);
            if ("---".equals(line) || "...".equals(line)) {
                break;
            }
            if (StringUtils.startsWithIgnoreCase(line, key + ":")) {
                String inlineValue = StringUtils.strip(StringUtils.substringAfter(line, ":"), "\"' ");
                if (StringUtils.isBlank(inlineValue) || isYamlBlockScalarHeader(inlineValue)
                    || isSymbolOnly(inlineValue)) {
                    return extractIndentedValue(lines, i + 1, leadingWhitespaceCount(lines[i]));
                }
                return sanitizeDescription(inlineValue);
            }
        }
        return null;
    }

    /**
     * Reads a YAML block scalar (description: &gt; / |) and the compatible historical form where the value line
     * contains only symbols. The value ends at the next front-matter delimiter or sibling top-level property.
     */
    private static String extractIndentedValue(String[] lines, int startLine, int keyIndent) {
        List<String> valueLines = new ArrayList<>();
        for (int i = startLine; i < lines.length; i++) {
            String trimmed = StringUtils.trimToEmpty(lines[i]);
            if ("---".equals(trimmed) || "...".equals(trimmed)) {
                break;
            }
            if (StringUtils.isNotBlank(trimmed) && leadingWhitespaceCount(lines[i]) <= keyIndent) {
                break;
            }
            valueLines.add(trimmed);
        }
        if (valueLines.isEmpty()) {
            return null;
        }
        // Skill descriptions are displayed as plain summaries. Fold both YAML scalar styles into stable text so
        // formatting-only line wraps do not leak into the resource card or database description.
        return sanitizeDescription(String.join("\n", valueLines));
    }

    private static String sanitizeDescription(String description) {
        if (StringUtils.isBlank(description)) {
            return null;
        }
        List<String> contentLines = description.lines()
            .map(StringUtils::trimToEmpty)
            .collect(Collectors.toCollection(ArrayList::new));
        while (!contentLines.isEmpty()
            && (StringUtils.isBlank(contentLines.get(0)) || isSymbolOnly(contentLines.get(0)))) {
            contentLines.remove(0);
        }
        String result = contentLines.stream()
            .filter(StringUtils::isNotBlank)
            .collect(Collectors.joining(" "));
        return StringUtils.trimToNull(result);
    }

    private static boolean isYamlBlockScalarHeader(String value) {
        String marker = StringUtils.trimToEmpty(StringUtils.substringBefore(value, "#"));
        return marker.matches("[>|][+\\-1-9]*");
    }

    private static boolean isSymbolOnly(String value) {
        return StringUtils.isNotBlank(value) && value.codePoints().noneMatch(Character::isLetterOrDigit);
    }

    private static int leadingWhitespaceCount(String line) {
        int index = 0;
        while (index < line.length() && Character.isWhitespace(line.charAt(index))) {
            index++;
        }
        return index;
    }

    private static String stripFrontMatter(String content) {
        FrontMatterText frontMatterText = normalizeFrontMatter(content);
        if (!frontMatterText.hasFrontMatter()) {
            return frontMatterText.text();
        }
        String[] lines = frontMatterText.text().split("\\R", -1);
        for (int i = frontMatterText.startLine(); i < lines.length; i++) {
            String line = StringUtils.trimToEmpty(lines[i]);
            if ("---".equals(line) || "...".equals(line)) {
                return String.join("\n", Arrays.copyOfRange(lines, i + 1, lines.length));
            }
        }
        int firstContentLine = frontMatterText.startLine();
        while (firstContentLine < lines.length && isYamlMetadataLine(lines[firstContentLine])) {
            firstContentLine++;
        }
        return String.join("\n", Arrays.copyOfRange(lines, firstContentLine, lines.length));
    }

    private static FrontMatterText normalizeFrontMatter(String content) {
        String text = StringUtils.removeStart(content, "\uFEFF");
        if (!text.startsWith("---")) {
            return new FrontMatterText(text, false, 0);
        }
        String[] lines = text.split("\\R", -1);
        String firstLine = StringUtils.trimToEmpty(lines[0]);
        if ("---".equals(firstLine)) {
            return new FrontMatterText(text, true, 1);
        }
        if (firstLine.startsWith("--- ")) {
            lines[0] = StringUtils.trimToEmpty(firstLine.substring(4));
            return new FrontMatterText(String.join("\n", lines), true, 0);
        }
        return new FrontMatterText(text, true, 1);
    }

    private static boolean isYamlMetadataLine(String line) {
        String trimmed = StringUtils.trimToEmpty(line);
        return StringUtils.isBlank(trimmed) || "---".equals(trimmed) || "...".equals(trimmed)
            || trimmed.matches("[A-Za-z_][A-Za-z0-9_-]*\\s*:.*");
    }

    private record FrontMatterText(String text, boolean hasFrontMatter, int startLine) {
    }
}
